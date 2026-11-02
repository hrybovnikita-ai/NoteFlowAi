const { embedText, cosineSimilarity } = require("../utils/textEmbedding");

const SIMILARITY_THRESHOLD = Number(process.env.KNOWLEDGE_GRAPH_MIN_SIMILARITY || 0.28);
const MAX_EDGES_PER_NODE = Number(process.env.KNOWLEDGE_GRAPH_MAX_EDGES || 6);

function createKnowledgeGraphService(db) {
  if (db.kind !== "postgres") throw new Error("Knowledge graph requires PostgreSQL.");

  async function rebuild(uid) {
    const notes = await db.query(
      "SELECT id, title, content FROM notes WHERE user_id = $1 AND is_archived = false",
      [uid],
    );
    const vectors = new Map();
    for (const note of notes.rows) {
      const vector = embedText(`${note.title}\n${note.content}`);
      vectors.set(note.id, vector);
      await db.query(
        `INSERT INTO note_embeddings (user_id, note_id, vector, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (user_id, note_id) DO UPDATE SET vector = excluded.vector, updated_at = now()`,
        [uid, note.id, JSON.stringify(vector)],
      );
    }

    await db.query("DELETE FROM note_relationships WHERE user_id = $1", [uid]);
    const ids = [...vectors.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      const scored = [];
      for (let j = 0; j < ids.length; j += 1) {
        if (i === j) continue;
        const similarity = cosineSimilarity(vectors.get(ids[i]), vectors.get(ids[j]));
        if (similarity >= SIMILARITY_THRESHOLD) scored.push({ target: ids[j], similarity });
      }
      scored.sort((a, b) => b.similarity - a.similarity);
      for (const edge of scored.slice(0, MAX_EDGES_PER_NODE)) {
        await db.query(
          `INSERT INTO note_relationships (user_id, source_note_id, target_note_id, similarity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [uid, ids[i], edge.target, edge.similarity],
        );
      }
    }
    return { nodes: ids.length, edges: (await db.query("SELECT count(*)::int AS count FROM note_relationships WHERE user_id = $1", [uid])).rows[0].count };
  }

  return {
    rebuild,
    async graph(uid, { q = "", minSimilarity } = {}) {
      const threshold = Number.isFinite(minSimilarity) ? minSimilarity : SIMILARITY_THRESHOLD;
      const notes = await db.query(
        `SELECT n.id, n.title, left(n.content, 180) AS preview, n.updated_at AS "updatedAt"
         FROM notes n WHERE n.user_id = $1 AND n.is_archived = false`,
        [uid],
      );
      let nodes = notes.rows;
      if (q.trim()) {
        const query = `%${q.trim().toLowerCase()}%`;
        nodes = nodes.filter(node => node.title.toLowerCase().includes(query.replace(/%/g, ""))
          || node.preview.toLowerCase().includes(query.replace(/%/g, "")));
      }
      const nodeIds = new Set(nodes.map(node => node.id));
      const edges = (await db.query(
        `SELECT source_note_id AS source, target_note_id AS target, similarity
         FROM note_relationships WHERE user_id = $1 AND similarity >= $2`,
        [uid, threshold],
      )).rows.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
      return { nodes, edges, threshold };
    },
  };
}

module.exports = { createKnowledgeGraphService };
