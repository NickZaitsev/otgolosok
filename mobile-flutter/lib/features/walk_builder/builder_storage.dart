// Device storage of the walk builder: the draft (site `otgolosok:walk:v1`), guest walks (site
// `local-store.ts`, `otgolosok:walks:v2`) and the small markers that tie them together. Every write
// is compare-and-set against the text the caller read, so a copy that could not be parsed is never
// overwritten, and every write is read back before it counts as saved.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../walk_engine/walk_view.dart' show WalkDocument, validateWalkDocumentJson;
import '../walks/local_walks.dart';
import 'model.dart';

/// Text values by key; keys are `[a-z0-9-]`, values are UTF-8 text.
abstract interface class BuilderStorage {
  Future<String?> read(String key);

  /// Replaces the value; fails unless the new value reads back.
  Future<void> write(String key, String value);

  Future<void> remove(String key);
}

/// Storage keys, the site's localStorage keys without the `otgolosok:walk:` prefix.
abstract final class BuilderKeys {
  static const draft = 'draft';
  static const walks = 'walks';
  static const activeLocal = 'active-local';
  static const activeAccount = 'active-account';
  static const activeRevision = 'active-revision';
  static String pending(String id) => 'pending-$id';
  static String accountOperation(String id) => 'account-operation-$id';
}

final _key = RegExp(r'^[a-z0-9-]{1,120}$');

/// One file per key in [directory]; a write goes to a temporary file that replaces the old one by
/// rename, so a crash leaves either the old or the new text, never half of it.
class FileBuilderStorage implements BuilderStorage {
  FileBuilderStorage(this._directory);

  /// Resolved lazily so creating the storage needs no I/O.
  final Future<Directory> Function() _directory;
  Future<Directory>? _opened;

  Future<File> _file(String key) async {
    if (!_key.hasMatch(key)) throw ArgumentError.value(key, 'key');
    final opened = _opened ??= () async {
      final directory = await _directory();
      await directory.create(recursive: true);
      return directory;
    }();
    try {
      final directory = await opened;
      return File('${directory.path}${Platform.pathSeparator}$key.json');
    } catch (_) {
      // A failed open is retried by the next call instead of failing forever.
      _opened = null;
      rethrow;
    }
  }

  @override
  Future<String?> read(String key) async {
    final file = await _file(key);
    try {
      return await file.readAsString();
    } on PathNotFoundException {
      return null;
    }
  }

  @override
  Future<void> write(String key, String value) async {
    final file = await _file(key);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(value, flush: true);
    await temporary.rename(file.path);
    if (await file.readAsString() != value) throw StateError('write verification failed');
  }

  @override
  Future<void> remove(String key) async {
    final file = await _file(key);
    try {
      await file.delete();
    } on PathNotFoundException {
      // Already absent.
    }
  }
}

/// In-memory storage for tests and previews.
class MemoryBuilderStorage implements BuilderStorage {
  MemoryBuilderStorage([Map<String, String>? values]) : values = values ?? {};

  final Map<String, String> values;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> remove(String key) async => values.remove(key);
}

/// Runs async sections one after another, so a read-compare-write is never interleaved.
class SerialQueue {
  Future<void> _tail = Future<void>.value();

  Future<T> run<T>(Future<T> Function() task) {
    final result = _tail.then((_) => task());
    _tail = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }
}

const draftConflictMessage = 'Черновик изменён в другой вкладке. Обновите страницу перед продолжением; эта версия не записана.';

/// The builder draft (site `saveDraft`).
class DraftStore {
  DraftStore(this.storage);

  final BuilderStorage storage;

  Future<String?> read() => storage.read(BuilderKeys.draft);

  /// Writes [draft] when the stored text is still [previous]; returns the new stored text.
  Future<String> save(Draft draft, String? previous) async {
    if (await storage.read(BuilderKeys.draft) != previous) throw StateError(draftConflictMessage);
    final raw = draft.encode();
    parseDraft(raw);
    await storage.write(BuilderKeys.draft, raw);
    return raw;
  }
}

const _corrupt = 'Хранилище прогулок повреждено. Исходная запись сохранена.';
const _unknownVersion = 'Неизвестная версия библиотеки прогулок. Исходная запись сохранена.';
const _conflict = 'Прогулка изменена в другой вкладке. Обновите список перед сохранением.';
const _unverified = 'Не удалось проверить сохранение прогулки. Исходные данные не удалены.';

typedef _Library = ({Map<String, Object?> value, String? raw});

/// Guest walks on this device, the `{version: 2, legacyId, items}` library of `local-store.ts`.
///
/// Reads fail with a [FormatException] and saves with a [StateError], both with a Russian message;
/// a damaged library is never rewritten.
class DeviceLocalWalkStore implements LocalWalkStore {
  DeviceLocalWalkStore(this._storage, {DateTime Function()? now}) : _now = now ?? DateTime.now;

  final BuilderStorage _storage;
  final DateTime Function() _now;
  final _queue = SerialQueue();

  Future<_Library> _read() async {
    final raw = await _storage.read(BuilderKeys.walks);
    if (raw == null) return (value: <String, Object?>{'version': 2, 'legacyId': null, 'items': <String, Object?>{}}, raw: null);
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      throw const FormatException(_corrupt);
    }
    final items = decoded is Map<String, Object?> ? decoded['items'] : null;
    final legacyId = decoded is Map<String, Object?> ? decoded['legacyId'] : null;
    if (decoded is! Map<String, Object?> || decoded['version'] != 2 || items is! Map<String, Object?> || (legacyId != null && legacyId is! String)) {
      throw const FormatException(_unknownVersion);
    }
    for (final MapEntry(:key, :value) in items.entries) {
      final item = value is Map<String, Object?> ? value : null;
      final document = item?['document'];
      final revision = item?['revision'];
      if (item == null || document is! Map<String, Object?> || document['id'] != key || revision is! int || revision < 0) {
        throw const FormatException(_corrupt);
      }
      try {
        validateWalkDocumentJson(document);
      } on FormatException {
        throw const FormatException(_corrupt);
      }
    }
    return (value: decoded, raw: raw);
  }

  LocalWalk _item(Object? value) {
    final item = value! as Map<String, Object?>;
    final updatedAt = item['updatedAt'];
    return LocalWalk(
      document: WalkDocument.fromJson(item['document']),
      revision: item['revision']! as int,
      updatedAt: updatedAt is String ? DateTime.tryParse(updatedAt) : null,
    );
  }

  @override
  Future<List<LocalWalk>> list() => _queue.run(() async {
        final library = await _read();
        return [for (final item in (library.value['items']! as Map<String, Object?>).values) _item(item)];
      });

  @override
  Future<LocalWalk?> get(String id) => _queue.run(() async {
        final item = (await _read()).value['items']! as Map<String, Object?>;
        return item.containsKey(id) ? _item(item[id]) : null;
      });

  /// The stored JSON of a walk, exactly as saved; the builder keeps editing this form.
  Future<({Map<String, Object?> document, int revision})?> getJson(String id) => _queue.run(() async {
        final items = (await _read()).value['items']! as Map<String, Object?>;
        final item = items[id] as Map<String, Object?>?;
        return item == null ? null : (document: item['document']! as Map<String, Object?>, revision: item['revision']! as int);
      });

  @override
  Future<LocalWalk> save(WalkDocument document, {int? expectedRevision}) async {
    final json = jsonDecode(jsonEncode(document.toJson())) as Map<String, Object?>;
    final revision = await saveJson(json, expectedRevision: expectedRevision);
    return LocalWalk(document: document, revision: revision, updatedAt: _now());
  }

  /// Saves a walk document given as JSON; returns its new revision.
  Future<int> saveJson(Map<String, Object?> document, {int? expectedRevision}) => _queue.run(() async {
        validateWalkDocumentJson(document);
        final library = await _read();
        final items = library.value['items']! as Map<String, Object?>;
        final id = document['id']! as String;
        final prior = items[id] as Map<String, Object?>?;
        if (prior != null ? prior['revision'] != expectedRevision : expectedRevision != null) throw StateError(_conflict);
        final revision = prior == null ? 0 : (prior['revision']! as int) + 1;
        final next = jsonEncode({
          ...library.value,
          'items': {
            ...items,
            id: {'document': document, 'revision': revision, 'updatedAt': _now().toUtc().toIso8601String()},
          },
        });
        if (await _storage.read(BuilderKeys.walks) != library.raw) throw StateError(_conflict);
        try {
          await _storage.write(BuilderKeys.walks, next);
        } catch (error) {
          debugPrint('local walks: write failed: $error');
          throw StateError(_unverified);
        }
        return revision;
      });
}

/// A random version-4 UUID (`crypto.randomUUID()`).
String newUuid([Random? random]) {
  final source = random ?? Random.secure();
  final bytes = [for (var i = 0; i < 16; i++) source.nextInt(256)];
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = [for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0')].join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// The builder's files live in the app support directory, which the system never clears on its own.
final builderStorageProvider = Provider<BuilderStorage>(
  (ref) => FileBuilderStorage(() async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}walk-builder')),
);

/// The one guest-walk store of the app; `localWalkStoreProvider` should be overridden with it.
final deviceLocalWalkStoreProvider = Provider<DeviceLocalWalkStore>((ref) => DeviceLocalWalkStore(ref.watch(builderStorageProvider)));
