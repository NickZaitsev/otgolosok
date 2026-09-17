import { randomUUID } from 'node:crypto';
import { addressKey, failure, sha256 } from './domain.mjs';
import { walkResearchKey, validateWalkResearch, validateRecoveryToken, canRetryWalk } from './walk-research.mjs';

export function createWalkResearchStore({ db, now, transaction, checkCapacity }) {
  db.exec('CREATE TABLE IF NOT EXISTS walk_research_cache (cache_key TEXT PRIMARY KEY, record_json TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS walk_research_grants (token_hash TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY (token_hash, job_id))');
  const decode = row => row ? JSON.parse(row.record_json) : null;
  const get = id => decode(db.prepare('SELECT record_json FROM jobs WHERE id = ?').get(id));
  const byKey = key => decode(db.prepare('SELECT record_json FROM jobs WHERE job_key = ?').get(key));
  const insert = job => db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run(job.id, job.key, job.stage, job.createdAt, JSON.stringify(job));
  const reserve = units => {
    checkCapacity(units);
    const timestamp = new Date(now()).toISOString();
    return { timestamp, ledger: count => {
      for (let i = 0; i < count; i++) db.prepare('INSERT INTO retries VALUES (?)').run(timestamp);
    } };
  };
  return {
    lookupWalkResearch(request, recoveryToken) {
      const tokenHash = sha256(validateRecoveryToken(recoveryToken));
      const job = byKey(walkResearchKey(request));
      return job?.kind === 'walk_research' && db.prepare('SELECT 1 FROM walk_research_grants WHERE token_hash = ? AND job_id = ?').get(tokenHash, job.id) ? job : null;
    },
    revokeWalkResearchAccess(jobIds) {
      if(!Array.isArray(jobIds)||!jobIds.length)return 0;
      let changed=0;
      for(const id of jobIds){const job=get(id);if(!job||job.kind!=="walk_research")continue;db.prepare("DELETE FROM walk_research_grants WHERE job_id=?").run(id);if(!["ready","failed","insufficient_evidence"].includes(job.stage)){const next={...job,stage:"failed",revision:job.revision+1,updatedAt:new Date(now()).toISOString(),error:{code:"ACCOUNT_DELETED"},data:{phase:"cancelled",candidates:null,route:null,stories:[]}};db.prepare("UPDATE jobs SET stage=?,record_json=? WHERE id=?").run(next.stage,JSON.stringify(next),id);}changed++;}return changed;
    },
    createWalkResearch(input, { allowCreate = true } = {}) {
      const request = validateWalkResearch(input);
      const tokenHash = sha256(validateRecoveryToken(input.recoveryToken));
      return transaction(() => {
        const key = walkResearchKey(request), existing = byKey(key);
        if (existing) {
          if (existing.kind !== 'walk_research') throw failure('CONFLICT');
          db.prepare('INSERT OR IGNORE INTO walk_research_grants VALUES (?, ?)').run(tokenHash, existing.id);
          return existing;
        }
        if (!allowCreate) throw failure('PROVIDER_UNAVAILABLE');
        const { timestamp, ledger } = reserve(3);
        ledger(2); // The parent row accounts for the first unit.
        const job = { id: randomUUID(), key, kind: 'walk_research', request, stage: 'queued',
          revision: 0, attempts: 0, createdAt: timestamp, updatedAt: timestamp, error: null,
          data: { phase: 'discovery', candidates: null, route: null, stories: [] } };
        insert(job);
        db.prepare('INSERT INTO walk_research_grants VALUES (?, ?)').run(tokenHash, job.id);
        return job;
      });
    },
    retryWalkResearch(id, revision) {
      return transaction(() => {
        const job = get(id);
        if (!job || job.kind !== 'walk_research') return null;
        if (job.revision !== revision) throw failure('CONFLICT');
        if (!canRetryWalk(job)) throw failure('RETRY_LIMIT');
        const { timestamp, ledger } = reserve(3);
        ledger(3); // Conservatively reserve all candidates even for audio-only continuation.
        const next = { ...job, stage: 'queued', error: null, revision: job.revision + 1, updatedAt: timestamp };
        db.prepare('UPDATE jobs SET stage = ?, record_json = ? WHERE id = ?').run(next.stage, JSON.stringify(next), id);
        return next;
      });
    },
    walkAddressCheckpoint(address) {
      const key = addressKey(address), existing = byKey(key);
      if (existing && ((existing.kind ?? 'address') !== 'address' || existing.irrelevant)) return { blocked: true };
      const cached = decode(db.prepare('SELECT record_json FROM walk_research_cache WHERE cache_key = ?').get(key));
      if (cached?.publicId && get(cached.publicId)?.irrelevant) return { blocked: true };
      const publication = byKey(`walk-story:${key}`);
      if (publication && (publication.irrelevant || publication.kind !== 'address')) return { blocked: true };
      if (existing?.stage === 'ready' && existing.data?.story && existing.data?.audio) return existing;
      if (publication?.stage === 'ready') return publication;
      if (cached?.data?.story || cached?.data?.evidence) return cached;
      if (existing?.data?.evidence || existing?.data?.story) return existing;
      return cached;
    },
    saveWalkCheckpoint(address, checkpoint) {
      db.prepare('INSERT INTO walk_research_cache VALUES (?, ?) ON CONFLICT(cache_key) DO UPDATE SET record_json = excluded.record_json')
        .run(addressKey(address), JSON.stringify(checkpoint));
    },
    validateWalkPublication(story) {
      const publication = get(story.id);
      if (!publication || (publication.kind ?? 'address') !== 'address' || publication.irrelevant || publication.stage !== 'ready'
        || !publication.data?.story || !publication.data?.audio || addressKey(publication.address) !== addressKey(story.place.address)
        || this.walkAddressCheckpoint(story.place.address)?.blocked) throw failure('STORY_UNAVAILABLE');
      return publication;
    },
    publishWalkStory(address, checkpoint) {
      return transaction(() => {
        const key = addressKey(address), existing = byKey(key);
        if (existing && ((existing.kind ?? 'address') !== 'address' || existing.irrelevant)) throw failure('STORY_UNAVAILABLE');
        if (existing?.stage === 'ready' && existing.data?.story && existing.data?.audio) return existing;
        if (checkpoint.stage !== 'ready' || !checkpoint.data?.story || !checkpoint.data?.audio) throw failure('CONFLICT');
        // Never mutate a user's address job, even when it has only partial evidence.
        const publicationKey = existing ? `walk-story:${key}` : key, published = byKey(publicationKey);
        if (published) {
          if (published.kind !== 'address' || published.irrelevant || published.stage !== 'ready') throw failure('STORY_UNAVAILABLE');
          return published;
        }
        const timestamp = new Date(now()).toISOString();
        const job = { ...checkpoint, id: randomUUID(), key: publicationKey, kind: 'address', address,
          quotaExempt: true, stage: 'ready', revision: 0, attempts: 1, error: null, createdAt: timestamp, updatedAt: timestamp };
        insert(job);
        db.prepare('INSERT INTO walk_research_cache VALUES (?, ?) ON CONFLICT(cache_key) DO UPDATE SET record_json = excluded.record_json')
          .run(key, JSON.stringify({ ...checkpoint, publicId: job.id }));
        return job;
      });
    },
  };
}
