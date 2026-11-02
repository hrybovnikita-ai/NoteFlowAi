const express = require('express');
const { requireObject } = require('../utils/validation');
const { HttpError } = require('../utils/httpError');
function createSettingsRouter(db) {
  const router = express.Router();
  const defaults = { defaultSort: 'updated_at', compactNotes: false };
  if (db.kind !== 'firestore') db.exec('CREATE TABLE IF NOT EXISTS user_settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preferences TEXT NOT NULL)');
  const read = async uid => db.kind === 'firestore' ? db.getSettings(uid) : JSON.parse(db.prepare('SELECT preferences FROM user_settings WHERE user_id = ?').get(uid)?.preferences || JSON.stringify(defaults));
  router.get('/', async (req, res) => res.json({ settings: await read(req.user.id) }));
  router.patch('/', async (req, res) => {
    requireObject(req.body);
    if (!Object.keys(req.body).length || Object.keys(req.body).some(k => !Object.hasOwn(defaults, k))) throw new HttpError(400, 'Unsupported settings fields.', 'INVALID_INPUT');
    if (req.body.defaultSort !== undefined && !['updated_at', 'created_at', 'title'].includes(req.body.defaultSort)) throw new HttpError(400, 'Invalid note sort order.', 'INVALID_INPUT');
    if (req.body.compactNotes !== undefined && typeof req.body.compactNotes !== 'boolean') throw new HttpError(400, 'compactNotes must be boolean.', 'INVALID_INPUT');
    let settings;
    if (db.kind === 'firestore') settings = await db.saveSettings(req.user.id, req.body);
    else {
      settings = { ...await read(req.user.id), ...req.body };
      db.prepare('INSERT INTO user_settings (user_id, preferences) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences').run(req.user.id, JSON.stringify(settings));
    }
    res.json({ settings });
  });
  return router;
}
module.exports = { createSettingsRouter };
