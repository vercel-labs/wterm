/** Display-only OSC 7 metadata. Null clears it; undefined ignores an invalid report. */
export function reportedDirectory(uri: string): string | null | undefined {
  if (uri === "") return null;
  if (uri.length > 2047) return undefined;
  // Preserve the actual path: URL.pathname would normalize dot segments,
  // changing the meaning of paths containing symlinks. Never open this URI.
  const match = /^file:\/\/([^/]*)(\/[^?#\\]*)$/i.exec(uri);
  if (!match) return undefined;
  const [, host, encodedPath] = match;
  if (host.length > 255 || !/^(?:[a-z0-9._-]+|\[[a-f0-9:.]+\])?$/i.test(host))
    return undefined;
  try {
    // Validate the authority, particularly bracketed IPv6. Credentials and
    // ports were excluded above. The reported host is not authenticated.
    new URL(`file://${host}/`);
    const path = decodeURIComponent(encodedPath);
    if (/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(path))
      return undefined;
    return host ? `${host}:${path}` : path;
  } catch {
    return undefined;
  }
}
