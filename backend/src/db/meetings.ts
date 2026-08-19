import { getDb } from "./index.js";

export interface MeetingRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  summary: string | null;
  action_items: string | null;
  notes: string | null;
  created_at: string;
}

export interface MeetingListRow extends MeetingRow {
  chunk_count: number;
  audio_secs: number;
}

export interface TranscriptChunkRow {
  id: number;
  timestamp: string;
  transcription: string;
  duration_secs: number | null;
}

function lastInsertId(): number {
  const row = getDb()
    .prepare(`SELECT last_insert_rowid() as id`)
    .get() as { id: number };
  return row.id;
}

export function createMeeting(startedAt: string): number {
  getDb()
    .prepare(`INSERT INTO meetings (started_at) VALUES (?)`)
    .run(startedAt);
  return lastInsertId();
}

export function closeMeeting(id: number, endedAt: string): void {
  getDb()
    .prepare(`UPDATE meetings SET ended_at = ? WHERE id = ? AND ended_at IS NULL`)
    .run(endedAt, id);
}

/** Close meetings left open by a crash: end at their last chunk, or their start. */
export function closeOrphanOpenMeetings(): void {
  getDb()
    .prepare(
      `UPDATE meetings
       SET ended_at = COALESCE(
         (SELECT MAX(timestamp) FROM audio_transcriptions WHERE meeting_id = meetings.id),
         started_at
       )
       WHERE ended_at IS NULL`
    )
    .run();
}

/** Delete closed meetings that never got a transcription (5min grace for in-flight chunks). */
export function deleteStaleEmptyMeetings(): void {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      `DELETE FROM meetings
       WHERE ended_at IS NOT NULL AND ended_at < ?
         AND id NOT IN (
           SELECT DISTINCT meeting_id FROM audio_transcriptions WHERE meeting_id IS NOT NULL
         )`
    )
    .run(cutoff);
}

/** Group pre-feature transcriptions (meeting_id IS NULL) into meetings by >gapMinutes gaps. */
export function backfillOrphanTranscriptions(gapMinutes = 5): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, timestamp, duration_secs FROM audio_transcriptions
       WHERE meeting_id IS NULL ORDER BY timestamp ASC`
    )
    .all() as Array<{ id: number; timestamp: string; duration_secs: number | null }>;
  if (rows.length === 0) return;

  const gapMs = gapMinutes * 60 * 1000;
  const groups: Array<typeof rows> = [];
  let current: typeof rows = [];
  let prevTime = 0;

  for (const row of rows) {
    const t = new Date(row.timestamp).getTime();
    if (current.length > 0 && t - prevTime > gapMs) {
      groups.push(current);
      current = [];
    }
    current.push(row);
    prevTime = t;
  }
  groups.push(current);

  const assign = db.prepare(`UPDATE audio_transcriptions SET meeting_id = ? WHERE id = ?`);
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const meetingId = createMeeting(first.timestamp);
    for (const row of group) assign.run(meetingId, row.id);
    const endMs =
      new Date(last.timestamp).getTime() + (last.duration_secs ?? 0) * 1000;
    closeMeeting(meetingId, new Date(endMs).toISOString());
  }
  console.log(
    `[meetings] backfilled ${rows.length} orphan transcriptions into ${groups.length} meetings`
  );
}

export function listMeetings(): MeetingListRow[] {
  return getDb()
    .prepare(
      `SELECT m.*, COUNT(a.id) AS chunk_count, COALESCE(SUM(a.duration_secs), 0) AS audio_secs
       FROM meetings m
       LEFT JOIN audio_transcriptions a ON a.meeting_id = m.id
       GROUP BY m.id
       HAVING m.ended_at IS NULL OR COUNT(a.id) > 0
       ORDER BY m.started_at DESC`
    )
    .all() as MeetingListRow[];
}

export function getMeeting(id: number): MeetingRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM meetings WHERE id = ?`)
    .get(id) as MeetingRow | undefined;
  return row ?? null;
}

export function getMeetingTranscript(id: number): TranscriptChunkRow[] {
  return getDb()
    .prepare(
      `SELECT id, timestamp, transcription, duration_secs
       FROM audio_transcriptions WHERE meeting_id = ? ORDER BY timestamp ASC`
    )
    .all(id) as TranscriptChunkRow[];
}

export function updateMeeting(
  id: number,
  fields: {
    title?: string | null;
    notes?: string | null;
    summary?: string | null;
    action_items?: string | null;
  }
): void {
  const sets: string[] = [];
  const values: Array<string | null> = [];
  for (const key of ["title", "notes", "summary", "action_items"] as const) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      values.push(fields[key] ?? null);
    }
  }
  if (sets.length === 0) return;
  getDb()
    .prepare(`UPDATE meetings SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values, id);
}
