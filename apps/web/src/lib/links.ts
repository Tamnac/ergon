export interface Segment {
  text: string;
  href?: string;
}

const LINK =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,:;"')\]!?])|(www\.[^\s<]*[^\s<.,:;"')\]!?])/g;

/** Splits text into plain and link segments: `[label](url)`, bare `http(s)://` and `www.` URLs. */
export function linkify(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, labelled, url, www] = match;
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    if (labelled) segments.push({ text: label!, href: labelled });
    else if (url) segments.push({ text: url, href: url });
    else segments.push({ text: www!, href: `https://${www}` });
    last = match.index + whole.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
