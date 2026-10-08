import { formatLagosDate } from '../lagos-time';

// French notification texts (spec 0008). A second language later adds a
// sibling file.

export interface PushText {
  title: string;
  body: string;
}

export function newEpisodeText(
  seriesTitle: string,
  seasonNumber: number,
  episodeNumber: number,
  episodeTitle: string,
): PushText {
  return {
    title: seriesTitle,
    body: `Nouvel épisode : S${seasonNumber} É${episodeNumber}, ${episodeTitle}`,
  };
}

// The body when several episodes were grouped (count above 1). The pipeline
// update in the processor builds the same text with $concat.
export const MANY_EPISODES_SUFFIX = ' nouveaux épisodes sont disponibles';

export function newSeriesText(
  seriesTitle: string,
  categoryName: string,
): PushText {
  return {
    title: `Nouvelle série : ${seriesTitle}`,
    body: `À découvrir dans ${categoryName}. Le premier épisode est disponible.`,
  };
}

export function premiumEndingText(reminder: 'd3' | 'd0'): PushText {
  return {
    title:
      reminder === 'd3'
        ? 'Ton premium se termine dans 3 jours'
        : 'Ton premium se termine aujourd’hui',
    body: 'Renouvelle ton abonnement pour continuer à tout regarder.',
  };
}

export function paymentSucceededText(endDate: Date | null): PushText {
  return {
    title: 'Paiement reçu',
    body: endDate
      ? `Ton premium est actif jusqu’au ${formatLagosDate(endDate)}.`
      : 'Ton premium est actif.',
  };
}

export function paymentFailedText(): PushText {
  return {
    title: 'Paiement échoué',
    body: 'Ton paiement n’a pas abouti. Tu peux réessayer depuis l’app.',
  };
}

export function testText(): PushText {
  return {
    title: 'Notification de test',
    body: 'Si tu vois ce message, les notifications Noli fonctionnent.',
  };
}
