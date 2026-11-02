const { randomUUID, createHash } = require('node:crypto');
const { HttpError } = require('../utils/httpError');

function safeId(value) {
  if (typeof value !== 'string' || !value || value.includes('/') || ['.', '..'].includes(value) || Buffer.byteLength(value) > 1500)
    throw new HttpError(400, 'Invalid document identifier.', 'INVALID_ID');
  return value;
}
function createFirestoreDatabase(firestore) {
  const user = uid => firestore.collection('users').doc(safeId(uid));
  const notes = uid => user(uid).collection('notes');
  const taxonomy = (uid, kind) => user(uid).collection(kind);
  const item = doc => doc.exists ? { ...doc.data(), id: doc.id } : null;
  async function saveTaxonomy(tx, uid, input) {
    const entries = [['categories', input.collection], ...input.tags.map(name => ['tags', name])].filter(([,name]) => name);
    const reads = await Promise.all(entries.map(([kind, name]) => tx.get(taxonomy(uid, kind).where('name', '==', name).limit(1))));
    entries.forEach(([kind, name], i) => {
      if (reads[i].empty) tx.set(taxonomy(uid, kind).doc(createHash('sha256').update(name).digest('hex')), { name, ...(kind === 'categories' ? { color: '#A855F7' } : {}) });
    });
  }
  return {
    kind: 'firestore', firestore, safeId,
    close: () => firestore.terminate(),
    async profile(claims) {
      const value = { uid: claims.uid, email: claims.email, displayName: claims.name || '', avatarUrl: claims.picture || '', provider: claims.firebase?.sign_in_provider || 'unknown' };
      await firestore.runTransaction(async tx => {
        const ref = user(claims.uid); const current = await tx.get(ref);
        tx.set(ref, { ...value, updatedAt: new Date().toISOString(), ...(!current.exists ? { createdAt: new Date().toISOString() } : {}) }, { merge: true });
      });
      return { id: claims.uid, firebaseUid: claims.uid, ...value };
    },
    async getNote(uid, id) { return item(await notes(uid).doc(safeId(id)).get()); },
    async listNotes(uid, { page, limit, sort, order, archived, favorite }) {
      let query = notes(uid).where('archived', '==', archived);
      if (favorite !== undefined) query = query.where('favorite', '==', favorite);
      const field = { created_at: 'createdAt', updated_at: 'updatedAt', title: 'title' }[sort];
      const total = (await query.count().get()).data().count;
      const snapshot = await query.orderBy(field, order).offset((page - 1) * limit).limit(limit).get();
      return { items: snapshot.docs.map(item), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },
    async createNote(uid, input, { maxNotes } = {}) {
      const ref = notes(uid).doc(randomUUID()); const now = new Date().toISOString();
      const meterRef = user(uid).collection("metadata").doc("noteUsage");
      const value = { ...input, createdAt: now, updatedAt: now };
      await firestore.runTransaction(async tx => {
        const meter = await tx.get(meterRef);
        const meteredCount = meter.data()?.noteCount;
        const existing = Number.isSafeInteger(meteredCount) ? null : await tx.get(notes(uid));
        const count = Number.isSafeInteger(meteredCount) ? meteredCount : existing.size;
        if (Number.isSafeInteger(maxNotes) && count >= maxNotes) {
          throw new HttpError(403, `Your plan allows up to ${maxNotes} notes. Upgrade to save more.`, "NOTE_LIMIT_REACHED", {
            limit: maxNotes, used: count,
          });
        }
        await saveTaxonomy(tx, uid, input);
        tx.create(ref, value);
        tx.set(meterRef, { noteCount: count + 1, updatedAt: now });
      });
      return { ...value, id: ref.id };
    },
    async updateNote(uid, id, changes) {
      const ref = notes(uid).doc(safeId(id));
      return firestore.runTransaction(async tx => {
        const current = await tx.get(ref); if (!current.exists) return null;
        const next = { ...current.data(), ...changes, updatedAt: new Date().toISOString() };
        await saveTaxonomy(tx, uid, next); tx.set(ref, next); return { ...next, id };
      });
    },
    async deleteNote(uid, id) {
      const ref = notes(uid).doc(safeId(id));
      const meterRef = user(uid).collection("metadata").doc("noteUsage");
      return firestore.runTransaction(async tx => {
        const [current, meter] = await Promise.all([tx.get(ref), tx.get(meterRef)]);
        if (!current.exists) return false;
        const meteredCount = meter.data()?.noteCount;
        const existing = Number.isSafeInteger(meteredCount) ? null : await tx.get(notes(uid));
        const count = Number.isSafeInteger(meteredCount) ? meteredCount : existing.size;
        tx.delete(ref);
        tx.set(meterRef, { noteCount: Math.max(0, count - 1), updatedAt: new Date().toISOString() });
        return true;
      });
    },
    async removeAllNotes(uid) {
      let deleted = 0;
      while (true) {
        const snapshot = await notes(uid).limit(400).get();
        if (snapshot.empty) break;
        const batch = firestore.batch(); snapshot.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); deleted += snapshot.size;
      }
      const meterRef = user(uid).collection("metadata").doc("noteUsage");
      await firestore.runTransaction(async tx => {
        const remaining = await tx.get(notes(uid));
        tx.set(meterRef, { noteCount: remaining.size, updatedAt: new Date().toISOString() });
      });
      return deleted;
    },
    async searchNotes(uid, query, { page, limit }) {
      // Firestore has no full-text index. Search only this user's unarchived notes.
      const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
      const snapshot = await notes(uid).where('archived', '==', false).get();
      const matches = snapshot.docs.map(item).filter(note => {
        const words = `${note.title} ${note.content}`.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
        return tokens.some(token => words.some(word => word.startsWith(token)));
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { items: matches.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: matches.length, pages: Math.ceil(matches.length / limit) } };
    },
    async listTaxonomy(uid, kind) { return (await taxonomy(uid, kind).orderBy('name').get()).docs.map(item); },
    async mutateTaxonomy(uid, kind, id, value, remove = false) {
      const ref = taxonomy(uid, kind).doc(id ? safeId(id) : randomUUID());
      return firestore.runTransaction(async tx => {
        const existing = await tx.get(ref);
        if (id && !existing.exists) throw new HttpError(404, 'Resource not found.', 'NOT_FOUND');
        if (!remove) {
          const duplicate = await tx.get(taxonomy(uid, kind).where('name', '==', value.name));
          if (duplicate.docs.some(doc => doc.id !== ref.id)) throw new HttpError(409, 'A resource with that name already exists.', 'DUPLICATE_RESOURCE');
        }
        const linked = existing.exists ? await tx.get(notes(uid).where(kind === 'categories' ? 'collection' : 'tags', kind === 'categories' ? '==' : 'array-contains', existing.data().name).limit(451)) : null;
        if (linked?.size > 450) throw new HttpError(409, 'This resource has too many linked notes for an atomic change. Move notes in smaller groups first.', 'TOO_MANY_LINKED_NOTES');
        linked?.docs.forEach(doc => tx.update(doc.ref, kind === 'categories' ? { collection: remove ? '' : value.name } : { tags: [...new Set(doc.data().tags.flatMap(name => name === existing.data().name ? (remove ? [] : [value.name]) : [name]))] }));
        if (remove) tx.delete(ref); else tx.set(ref, value);
        return { id: ref.id, ...value };
      });
    },
    async getSettings(uid) { return (await user(uid).collection('settings').doc('preferences').get()).data() || { defaultSort: 'updated_at', compactNotes: false }; },
    async saveSettings(uid, value) { await user(uid).collection('settings').doc('preferences').set(value, { merge: true }); return this.getSettings(uid); },
  };
}
module.exports = { createFirestoreDatabase, safeId };
