import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection } from 'mongoose';
import { adminVideoStatus, EpisodeVideoFields } from './content-access';
import {
  notReadyMatch,
  seriesStatsPipeline,
  TO_PROCESS_STATUSES,
  videosToProcessPipeline,
} from './video-status-query';

// Runs the dashboard spec 0010 pipelines on a real MongoDB, so their
// truthiness ($ifNull, missing fields, empty strings) is checked against
// adminVideoStatus, the rule the series page already shows.
jest.setTimeout(120_000);

type StatsRow = { episodes: number } & Record<
  (typeof TO_PROCESS_STATUSES)[number],
  number
>;

// Every combination the switch must order correctly, written raw (no Mongoose
// defaults), with missing fields, nulls and empty strings.
const EPISODES: EpisodeVideoFields[] = [
  { streamUid: 'uid' },
  { streamUid: 'uid', pendingStatus: 'error', pendingStreamUid: 'p' },
  { streamUid: 'uid', videoUrl: 'https://old' },
  { pendingStatus: 'error' },
  { pendingStatus: 'error', pendingStreamUid: 'p', videoUrl: 'https://old' },
  { pendingStreamUid: 'p' },
  { pendingStreamUid: 'p', pendingStatus: 'processing' },
  { pendingStreamUid: 'p', videoUrl: 'https://old' },
  { videoUrl: 'https://old' },
  {},
  { streamUid: null, pendingStreamUid: null, videoUrl: null },
  { streamUid: '', pendingStreamUid: '', videoUrl: '' },
  { streamUid: '', videoUrl: 'https://old' },
  { streamUid: null, pendingStreamUid: '', pendingStatus: 'error' },
];

describe('video status pipelines on MongoDB (dashboard spec 0010)', () => {
  let mongo: MongoMemoryServer;
  let conn: Connection;
  const col = () => conn.collection('series');

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { launchTimeout: 90_000 },
    });
    conn = await mongoose.createConnection(mongo.getUri()).asPromise();
  });

  afterAll(async () => {
    await conn?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await col().deleteMany({});
  });

  const expectedCounts = (episodes: EpisodeVideoFields[]) => {
    const counts = { none: 0, error: 0, pending: 0, legacy: 0 };
    for (const ep of episodes) {
      const { status } = adminVideoStatus(ep);
      if (status !== 'ready') counts[status] += 1;
    }
    return counts;
  };

  it('counts every status exactly as adminVideoStatus does', async () => {
    // Spread over three series, one without episodes and one without the field.
    await col().insertMany([
      { title: 'A', episodes: EPISODES.slice(0, 7) },
      { title: 'B', episodes: EPISODES.slice(7) },
      { title: 'C', episodes: [] },
      { title: 'D' },
    ]);

    const [row] = await col()
      .aggregate<StatsRow>(seriesStatsPipeline())
      .toArray();

    expect(row.episodes).toBe(EPISODES.length);
    const expected = expectedCounts(EPISODES);
    for (const status of TO_PROCESS_STATUSES) {
      expect({ status, count: row[status] }).toEqual({
        status,
        count: expected[status],
      });
    }
  });

  it.each(EPISODES.map((ep, i) => [i, ep] as const))(
    'agrees with adminVideoStatus on case %i alone',
    async (_i, ep) => {
      await col().insertOne({ title: 'Solo', episodes: [ep] });

      const [row] = await col()
        .aggregate<StatsRow>(seriesStatsPipeline())
        .toArray();
      const { status } = adminVideoStatus(ep);

      for (const s of TO_PROCESS_STATUSES) {
        expect(row[s]).toBe(s === status ? 1 : 0);
      }
    },
  );

  it('gives no row when there is no episode at all', async () => {
    await col().insertMany([
      { title: 'Vide', episodes: [] },
      { title: 'Sans' },
    ]);

    const rows = await col()
      .aggregate<StatsRow>(seriesStatsPipeline())
      .toArray();

    expect(rows).toEqual([]);
  });

  it('keeps exactly the series with an episode not ready, and counts them', async () => {
    const ready = { streamUid: 'uid' };
    const { insertedIds } = await col().insertMany([
      { title: 'Tout prêt', episodes: [ready, ready] },
      { title: 'Un à faire', episodes: [ready, { videoUrl: 'https://old' }] },
      { title: 'Vide', episodes: [] },
      { title: 'Sans champ' },
      { title: 'Tout', episodes: EPISODES },
    ]);

    const kept = await col()
      .find<{ title: string }>({ episodes: notReadyMatch })
      .project<{ title: string }>({ title: 1 })
      .toArray();
    expect(kept.map((s) => s.title).sort()).toEqual(['Tout', 'Un à faire']);

    const counts = await col()
      .aggregate<{
        _id: unknown;
        videosToProcess: number;
      }>(videosToProcessPipeline(Object.values(insertedIds)))
      .toArray();
    const byTitle = new Map(
      counts.map((c) => [String(c._id), c.videosToProcess]),
    );
    const notReady = EPISODES.filter(
      (ep) => adminVideoStatus(ep).status !== 'ready',
    ).length;
    expect(byTitle.get(String(insertedIds[0]))).toBe(0);
    expect(byTitle.get(String(insertedIds[1]))).toBe(1);
    expect(byTitle.get(String(insertedIds[2]))).toBe(0);
    expect(byTitle.get(String(insertedIds[3]))).toBe(0);
    expect(byTitle.get(String(insertedIds[4]))).toBe(notReady);

    // The filtered series' counts add up to the overview total.
    const [stats] = await col()
      .aggregate<StatsRow>(seriesStatsPipeline())
      .toArray();
    const total = TO_PROCESS_STATUSES.reduce((sum, s) => sum + stats[s], 0);
    expect(byTitle.get(String(insertedIds[1]))! + notReady).toBe(total);
  });
});
