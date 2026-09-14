import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';

export const db = new Firestore({ projectId: config.gcpProjectId });

export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function previousWeeks(n, from = new Date()) {
  const weeks = [];
  const d = new Date(from);
  for (let i = 1; i <= n; i++) {
    d.setDate(d.getDate() - 7);
    weeks.push(isoWeek(d));
  }
  return weeks;
}
