/** How sharing ended: the system sheet took it, the user closed the sheet, the link was copied, or it must be copied by hand. */
export type ShareOutcome = "shared" | "cancelled" | "copied" | "manual";

export type ShareEnvironment = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeText?: (text: string) => Promise<void>;
};

/** The browser's share and clipboard functions, bound so they can be called detached. */
export function browserShareEnvironment(): ShareEnvironment {
  return {
    share: typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined,
    canShare: typeof navigator.canShare === "function" ? navigator.canShare.bind(navigator) : undefined,
    writeText: navigator.clipboard && typeof navigator.clipboard.writeText === "function" ? navigator.clipboard.writeText.bind(navigator.clipboard) : undefined,
  };
}

/**
 * The system share sheet where there is one (phones), else the clipboard. A sheet the user closed is not a failure;
 * any other refusal (no user activation, an unsupported payload) falls back to copying the link.
 */
export async function sharePlace({ title, url }: { title: string; url: string }, env: ShareEnvironment): Promise<ShareOutcome> {
  const data: ShareData = { title, text: `${title} — история в «Отголоске»`, url };
  if (env.share && env.canShare?.(data) !== false) {
    try {
      await env.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  if (!env.writeText) return "manual";
  try {
    await env.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}
