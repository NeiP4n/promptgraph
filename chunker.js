const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const MAX_CHUNKS = 4;

export function chunkText(text) {
  // Split on markdown h1/h2/h3 headers to preserve semantic boundaries
  const sections = text.split(/(?=\n#{1,3} )/);
  const chunks = [];

  for (const section of sections) {
    const words = section.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (words.length <= CHUNK_SIZE) {
      chunks.push(section.trim());
    } else {
      let i = 0;
      while (i < words.length) {
        chunks.push(words.slice(i, i + CHUNK_SIZE).join(' '));
        if (i + CHUNK_SIZE >= words.length) break;
        i += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }
  }

  const result = chunks.length > 0 ? chunks : [text];
  return result.slice(0, MAX_CHUNKS);
}
