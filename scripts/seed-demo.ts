import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { CategorySchema } from '../src/categories/schemas/category.schema';
import { SeriesSchema } from '../src/series/schemas/series.schema';
import { UserSchema } from '../src/users/schemas/user.schema';
import { WatchHistorySchema } from '../src/watch-history/schemas/watch-history.schema';
import { slugify } from '../src/categories/slugify';

// Demo data for frontend testing (scope feature 19). Writes through the
// app's own schemas so defaults and casting match what the API produces.
// Every created id is recorded in the `demo_seed` collection, so --remove
// deletes exactly what this script created and nothing else.
//
//   npm run db:seed-demo              add the demo data (refuses if already there)
//   npm run db:seed-demo -- --remove  remove it
//   npm run db:seed-demo -- --reset   remove, then add again

const DEMO_PASSWORD = 'NoliDemo2026';
const IMG = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/noli-${seed}/${w}/${h}`;
// Short public test clips: they play, but are not real episodes.
const VIDEOS = [
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
  'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
];

const CATEGORIES: Array<[string, string]> = [
  ['Drame', 'Des histoires fortes, des familles et des destins qui basculent.'],
  ['Comédie', 'Pour rire en famille ou entre amis.'],
  ['Romance', 'Amours, rencontres et cœurs brisés.'],
  ['Action', 'Poursuites, combats et adrénaline.'],
  ['Thriller', 'Suspense et tension jusqu’au dernier épisode.'],
  ['Policier', 'Enquêtes, commissariats et affaires à résoudre.'],
  ['Famille', 'À regarder avec toute la maison.'],
  ['Fantastique', 'Mystères, légendes et forces surnaturelles.'],
  ['Histoire et culture', 'Royaumes, héros et traditions d’Afrique de l’Ouest.'],
  ['Jeunesse', 'Pour les plus jeunes.'],
];

interface DemoSeries {
  title: string;
  description: string;
  categories: string[];
  country: string;
  languages: string[];
  releaseYear: number;
  status: 'ongoing' | 'completed';
  isPremium: boolean;
  freeEpisodeCount: number;
  rating: number;
  votes: number;
  seasons: number[]; // episodes per season
  episodeTitles?: string[];
}

const SERIES: DemoSeries[] = [
  { title: 'Le Trône d’Abomey', description: 'Au cœur du royaume du Danxomè, deux princes se disputent l’héritage de leur père.', categories: ['Histoire et culture', 'Drame'], country: 'Bénin', languages: ['fr', 'fon'], releaseYear: 2025, status: 'ongoing', isPremium: true, freeEpisodeCount: 2, rating: 8.7, votes: 312, seasons: [6, 2] },
  { title: 'Cotonou Express', description: 'Un zémidjan au grand cœur se retrouve mêlé à une affaire qui le dépasse.', categories: ['Comédie', 'Action'], country: 'Bénin', languages: ['fr'], releaseYear: 2024, status: 'completed', isPremium: false, freeEpisodeCount: 0, rating: 7.9, votes: 540, seasons: [8] },
  { title: 'Amours de Dakar', description: 'Trois amies, trois histoires d’amour dans le Dakar d’aujourd’hui.', categories: ['Romance', 'Comédie'], country: 'Sénégal', languages: ['fr', 'wo'], releaseYear: 2025, status: 'ongoing', isPremium: true, freeEpisodeCount: 3, rating: 8.2, votes: 421, seasons: [7] },
  { title: 'Commissariat de Treichville', description: 'Une jeune inspectrice fait ses preuves dans le commissariat le plus animé d’Abidjan.', categories: ['Policier', 'Thriller'], country: 'Côte d’Ivoire', languages: ['fr'], releaseYear: 2024, status: 'completed', isPremium: true, freeEpisodeCount: 1, rating: 8.9, votes: 610, seasons: [5, 3] },
  { title: 'La Maison de Tata Akossiwa', description: 'Une grande famille de Lomé, une maison trop petite et beaucoup de secrets.', categories: ['Famille', 'Comédie'], country: 'Togo', languages: ['fr', 'ee'], releaseYear: 2023, status: 'completed', isPremium: false, freeEpisodeCount: 0, rating: 7.4, votes: 288, seasons: [6] },
  { title: 'Les Masques de la Nuit', description: 'Dans un village de l’Ouest, des masques sacrés disparaissent un à un.', categories: ['Fantastique', 'Thriller'], country: 'Burkina Faso', languages: ['fr'], releaseYear: 2025, status: 'ongoing', isPremium: true, freeEpisodeCount: 2, rating: 8.5, votes: 199, seasons: [4] },
  { title: 'Douala Business', description: 'Une start up camerounaise face aux requins de la finance.', categories: ['Drame'], country: 'Cameroun', languages: ['fr', 'en'], releaseYear: 2024, status: 'ongoing', isPremium: true, freeEpisodeCount: 1, rating: 7.8, votes: 175, seasons: [5] },
  { title: 'Soundjata, l’enfant lion', description: 'L’enfance et l’ascension du fondateur de l’empire du Mali.', categories: ['Histoire et culture', 'Jeunesse'], country: 'Mali', languages: ['fr', 'bm'], releaseYear: 2023, status: 'completed', isPremium: false, freeEpisodeCount: 0, rating: 9.1, votes: 702, seasons: [3] },
  { title: 'Vendetta à Conakry', description: 'Un ancien boxeur revient au pays pour venger son frère.', categories: ['Action', 'Thriller'], country: 'Guinée', languages: ['fr'], releaseYear: 2025, status: 'ongoing', isPremium: true, freeEpisodeCount: 2, rating: 8.0, votes: 233, seasons: [6] },
  { title: 'Mariage à Niamey', description: 'Préparer un mariage quand les deux familles ne s’entendent sur rien.', categories: ['Comédie', 'Romance', 'Famille'], country: 'Niger', languages: ['fr', 'ha'], releaseYear: 2024, status: 'completed', isPremium: false, freeEpisodeCount: 0, rating: 7.6, votes: 190, seasons: [4] },
  { title: 'Les Gardiens de la Lagune', description: 'Des adolescents découvrent qu’un esprit protège leur lagune.', categories: ['Jeunesse', 'Fantastique'], country: 'Gabon', languages: ['fr'], releaseYear: 2025, status: 'ongoing', isPremium: false, freeEpisodeCount: 0, rating: 8.3, votes: 154, seasons: [5] },
  { title: 'Le Secret du Docteur Mensah', description: 'Un médecin respecté de Porto Novo cache un passé que personne ne soupçonne.', categories: ['Drame', 'Thriller', 'Policier'], country: 'Bénin', languages: ['fr'], releaseYear: 2025, status: 'ongoing', isPremium: true, freeEpisodeCount: 3, rating: 8.6, votes: 268, seasons: [8] },
];

const USERS = [
  { email: 'demo.free@noli.test', username: 'demo_free', firstName: 'Aïcha', lastName: 'Demo', role: 'user', premium: false },
  { email: 'demo.premium@noli.test', username: 'demo_premium', firstName: 'Koffi', lastName: 'Demo', role: 'user', premium: true },
  { email: 'demo.admin@noli.test', username: 'demo_admin', firstName: 'Admin', lastName: 'Demo', role: 'admin', premium: false },
];

const DAY = 24 * 3600 * 1000;

async function main() {
  const mode = process.argv.includes('--remove') ? 'remove' : process.argv.includes('--reset') ? 'reset' : 'add';
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);

  // Loosely typed on purpose: this script only needs the schemas' defaults
  // and casting, not their strict TypeScript types.
  const Category = mongoose.model<any>('Category', CategorySchema);
  const Series = mongoose.model<any>('Series', SeriesSchema);
  const User = mongoose.model<any>('User', UserSchema);
  const WatchHistory = mongoose.model<any>('WatchHistory', WatchHistorySchema);
  const ledger = mongoose.connection.collection('demo_seed');

  const remove = async () => {
    const record = await ledger.findOne({ _id: 'demo' as any });
    if (!record) {
      console.log('No demo data recorded: nothing to remove.');
      return;
    }
    const userIds: Types.ObjectId[] = record.userIds ?? [];
    // Raw collection: matches userId whether it was stored as text or ObjectId.
    await mongoose.connection
      .collection('watchhistories')
      .deleteMany({ userId: { $in: [...userIds, ...userIds.map(String)] } });
    await User.deleteMany({ _id: { $in: userIds } });
    await Series.deleteMany({ _id: { $in: record.seriesIds ?? [] } });
    await Category.deleteMany({ _id: { $in: record.categoryIds ?? [] } });
    await ledger.deleteOne({ _id: 'demo' as any });
    console.log(
      `Removed ${record.categoryIds?.length ?? 0} categories, ${record.seriesIds?.length ?? 0} series, ${userIds.length} users and their watch history.`,
    );
  };

  if (mode === 'remove' || mode === 'reset') {
    await remove();
    if (mode === 'remove') {
      await mongoose.disconnect();
      return;
    }
  }

  if (await ledger.findOne({ _id: 'demo' as any })) {
    console.log('Demo data is already there. Use --reset to recreate it, or --remove to delete it.');
    await mongoose.disconnect();
    return;
  }

  // Categories: reuse one that already exists (same name key), never touch it.
  const createdCategoryIds: Types.ObjectId[] = [];
  const categoryIdByName = new Map<string, Types.ObjectId>();
  const last = await Category.findOne().sort({ displayOrder: -1 }).lean();
  let order = last ? (last as any).displayOrder + 1 : 0;
  for (const [name, description] of CATEGORIES) {
    const key = slugify(name);
    const existing: any = await Category.findOne({ nameKey: key }).lean();
    if (existing) {
      categoryIdByName.set(name, existing._id as Types.ObjectId);
      continue;
    }
    const doc = await Category.create({
      name,
      nameKey: key,
      slug: key,
      description,
      imageUrl: IMG(`cat-${key}`, 800, 800),
      isVisible: true,
      displayOrder: order++,
    });
    categoryIdByName.set(name, doc._id as Types.ObjectId);
    createdCategoryIds.push(doc._id as Types.ObjectId);
  }

  // Series with their episodes (pasted video links, playable as type 'direct').
  const createdSeries: Array<{ _id: Types.ObjectId; title: string; episodes: any[] }> = [];
  let videoIndex = 0;
  for (const [i, s] of SERIES.entries()) {
    if (await Series.exists({ title: s.title })) {
      console.log(`Skipped "${s.title}": a series with this title already exists.`);
      continue;
    }
    const key = slugify(s.title);
    const episodes: any[] = [];
    s.seasons.forEach((count, seasonIndex) => {
      for (let e = 1; e <= count; e++) {
        const season = seasonIndex + 1;
        episodes.push({
          seasonNumber: season,
          episodeNumber: e,
          title: e === 1 && season === 1 ? 'Pilote' : `Épisode ${e}`,
          description: `Saison ${season}, épisode ${e} de « ${s.title} ».`,
          videoUrl: VIDEOS[videoIndex++ % VIDEOS.length],
          duration: 1500 + ((i * 7 + e * 3) % 13) * 90,
          releaseDate: new Date(Date.now() - (60 - e - season * 10) * DAY),
          views: Math.round(s.votes * (12 - e)),
          thumbnail: IMG(`${key}-s${season}e${e}`, 1280, 720),
        });
      }
    });
    const doc = await Series.create({
      title: s.title,
      description: s.description,
      coverImage: IMG(`${key}-cover`, 1000, 1500),
      bannerImage: IMG(`${key}-banner`, 1920, 1080),
      categoryIds: s.categories.map((name) => categoryIdByName.get(name)!),
      languages: s.languages,
      country: s.country,
      releaseYear: s.releaseYear,
      rating: s.rating,
      votes: s.votes,
      status: s.status,
      isPremium: s.isPremium,
      freeEpisodeCount: s.freeEpisodeCount,
      episodes,
      totalEpisodes: episodes.length,
    });
    createdSeries.push({ _id: doc._id as Types.ObjectId, title: s.title, episodes });
  }

  // Test accounts.
  const createdUserIds: Types.ObjectId[] = [];
  const userIdByEmail = new Map<string, Types.ObjectId>();
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of USERS) {
    if (await User.exists({ email: u.email })) {
      console.log(`Skipped ${u.email}: this account already exists.`);
      continue;
    }
    const doc = await User.create({
      email: u.email,
      username: u.username,
      password,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      subscription: u.premium
        ? { plan: 'premium', isActive: true, startDate: new Date(), endDate: new Date(Date.now() + 365 * DAY) }
        : { plan: 'free', isActive: true, startDate: new Date() },
    });
    createdUserIds.push(doc._id as Types.ObjectId);
    userIdByEmail.set(u.email, doc._id as Types.ObjectId);
  }

  // A realistic history for the free account: two finished episodes, three
  // in progress (so "Continue watching" and "for me" have something to show).
  const freeId = userIdByEmail.get('demo.free@noli.test');
  if (freeId && createdSeries.length >= 4) {
    const picks: Array<[number, number, number]> = [
      [1, 0, 100], [1, 1, 100], [1, 2, 45],
      [2, 0, 70],
      [4, 0, 20],
    ];
    const episodes = picks.map(([si, ei, progress], n) => {
      const s = createdSeries[si];
      const ep = s.episodes[ei];
      const at = new Date(Date.now() - (picks.length - n) * 3600 * 1000);
      return {
        seriesId: String(s._id),
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        watchedDuration: Math.round((ep.duration * progress) / 100),
        totalDuration: ep.duration,
        progressPercentage: progress,
        isCompleted: progress === 100,
        watchedAt: at,
        lastWatchedAt: at,
      };
    });
    await WatchHistory.create({ userId: String(freeId), episodes });
  }

  await ledger.insertOne({
    _id: 'demo' as any,
    createdAt: new Date(),
    categoryIds: createdCategoryIds,
    seriesIds: createdSeries.map((s) => s._id),
    userIds: createdUserIds,
  });

  const episodeCount = createdSeries.reduce((n, s) => n + s.episodes.length, 0);
  console.log(
    `Demo data added: ${createdCategoryIds.length} categories (${CATEGORIES.length - createdCategoryIds.length} already existed), ${createdSeries.length} series, ${episodeCount} episodes, ${createdUserIds.length} accounts.`,
  );
  if (createdUserIds.length > 0) {
    console.log(`Accounts: ${USERS.map((u) => u.email).join(', ')} · password: ${DEMO_PASSWORD}`);
  }
  console.log('Remove it all with: npm run db:seed-demo -- --remove');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
