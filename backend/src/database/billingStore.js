const defaults = uid => ({ firebase_uid: uid, plan: 'free', status: 'free', customer_id: null, subscription_id: null, period_start: null, period_end: null, cancel_at_period_end: 0, synced_at: null, checkout_id: null, checkout_key: null, checkout_plan: null, checkout_started: null, lock_until: 0 });
function createBillingStore(db) {
  if (db.kind === 'postgres') {
    const allowedFields = new Set([
      'customer_id', 'subscription_id', 'plan', 'status', 'period_start',
      'period_end', 'cancel_at_period_end', 'synced_at', 'checkout_id',
      'checkout_key', 'checkout_plan', 'checkout_started', 'lock_owner', 'lock_until',
    ]);
    return {
      async row(uid) {
        return (await db.query('SELECT * FROM subscriptions WHERE firebase_uid = $1', [uid])).rows[0];
      },
      async ensure(uid) {
        await db.query('INSERT INTO subscriptions (firebase_uid) VALUES ($1) ON CONFLICT (firebase_uid) DO NOTHING', [uid]);
        return this.row(uid);
      },
      async update(uid, fields) {
        const entries = Object.entries(fields);
        if (entries.some(([key]) => !allowedFields.has(key))) throw new Error('Unsupported billing update field.');
        if (!entries.length) return;
        const values = [...entries.map(([, value]) => value), uid];
        const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(', ');
        await db.query(`UPDATE subscriptions SET ${assignments} WHERE firebase_uid = $${values.length}`, values);
      },
      async claim(uid, owner) {
        const result = await db.query(
          `UPDATE subscriptions SET lock_owner = $1, lock_until = $2
           WHERE firebase_uid = $3 AND lock_until < $4`,
          [owner, Date.now() + 120000, uid, Date.now()],
        );
        return result.rowCount > 0;
      },
      release: (uid, owner) => db.query(
        'UPDATE subscriptions SET lock_until = 0 WHERE firebase_uid = $1 AND lock_owner = $2',
        [uid, owner],
      ),
      async seen(id) {
        return (await db.query('SELECT 1 FROM billing_events WHERE id = $1', [id])).rowCount > 0;
      },
      record: id => db.query('INSERT INTO billing_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]),
      async customer(id) {
        return (await db.query('SELECT firebase_uid FROM subscriptions WHERE customer_id = $1', [id])).rows[0];
      },
    };
  }
  if (db.kind === 'firestore') {
    const accounts = db.firestore.collection('billingAccounts');
    const events = db.firestore.collection('billingEvents');
    const ref = uid => accounts.doc(db.safeId(uid));
    return {
      row: async uid => (await ref(uid).get()).data(),
      ensure: uid => db.firestore.runTransaction(async tx => { const snapshot = await tx.get(ref(uid)); if (snapshot.exists) return snapshot.data(); const value = defaults(uid); tx.create(ref(uid), value); return value; }),
      update: (uid, fields) => ref(uid).update(fields),
      claim: (uid, owner) => db.firestore.runTransaction(async tx => { const doc = await tx.get(ref(uid)); if (doc.data().lock_until >= Date.now()) return false; tx.update(ref(uid), { lock_owner: owner, lock_until: Date.now() + 120000 }); return true; }),
      release: (uid, owner) => db.firestore.runTransaction(async tx => { const doc = await tx.get(ref(uid)); if (doc.data().lock_owner === owner) tx.update(ref(uid), { lock_until: 0 }); }),
      seen: async id => (await events.doc(db.safeId(id)).get()).exists,
      record: id => events.doc(db.safeId(id)).set({ processed_at: new Date().toISOString() }),
      customer: async id => (await accounts.where('customer_id', '==', id).limit(1).get()).docs[0]?.data(),
    };
  }
  return {
    row: uid => db.prepare('SELECT * FROM billing_accounts WHERE firebase_uid = ?').get(uid),
    ensure(uid) { db.prepare('INSERT OR IGNORE INTO billing_accounts (firebase_uid) VALUES (?)').run(uid); return this.row(uid); },
    update(uid, fields) { const keys = Object.keys(fields); db.prepare(`UPDATE billing_accounts SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE firebase_uid = ?`).run(...Object.values(fields), uid); },
    claim: (uid, owner) => db.prepare('UPDATE billing_accounts SET lock_owner = ?, lock_until = ? WHERE firebase_uid = ? AND lock_until < ?').run(owner, Date.now() + 120000, uid, Date.now()).changes > 0,
    release: (uid, owner) => db.prepare('UPDATE billing_accounts SET lock_until = 0 WHERE firebase_uid = ? AND lock_owner = ?').run(uid, owner),
    seen: id => Boolean(db.prepare('SELECT 1 FROM billing_events WHERE id = ?').get(id)),
    record: id => db.prepare('INSERT OR IGNORE INTO billing_events (id, processed_at) VALUES (?, ?)').run(id, new Date().toISOString()),
    customer: id => db.prepare('SELECT firebase_uid FROM billing_accounts WHERE customer_id = ?').get(id),
  };
}
module.exports = { createBillingStore };
