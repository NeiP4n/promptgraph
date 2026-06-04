const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export function chunkText(text) {
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(' ');
    chunks.push(chunk);
    if (i + CHUNK_SIZE >= words.length) break;
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks.length > 0 ? chunks : [text];
}
