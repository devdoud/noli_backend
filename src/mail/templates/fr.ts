// French email templates (spec 0007). One function per email; a second
// language later adds a sibling file, the MailService picks it.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function greeting(firstName?: string | null): string {
  return firstName ? `Bonjour ${firstName},` : 'Bonjour,';
}

// Escapes the only user supplied value that reaches the HTML (the first name).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px">${p}</p>`)
    .join('');
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a"><div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;font-size:15px;line-height:1.5">${body}<p style="margin:24px 0 0;color:#666;font-size:13px">L’équipe Noli</p></div></body></html>`;
}

export function passwordResetCodeEmail(
  code: string,
  firstName?: string | null,
): EmailContent {
  const hello = greeting(firstName);
  return {
    subject: `Ton code Noli : ${code}`,
    html: layout([
      escapeHtml(hello),
      'Voici ton code pour réinitialiser ton mot de passe Noli :',
      `<strong style="font-size:28px;letter-spacing:6px">${code}</strong>`,
      'Il expire dans 15 minutes et ne fonctionne qu’une seule fois.',
      'Si tu n’as rien demandé, ignore cet email : ton mot de passe ne change pas.',
    ]),
    text: [
      hello,
      '',
      `Voici ton code pour réinitialiser ton mot de passe Noli : ${code}`,
      '',
      'Il expire dans 15 minutes et ne fonctionne qu’une seule fois.',
      'Si tu n’as rien demandé, ignore cet email : ton mot de passe ne change pas.',
      '',
      'L’équipe Noli',
    ].join('\n'),
  };
}

export function passwordChangedEmail(firstName?: string | null): EmailContent {
  const hello = greeting(firstName);
  return {
    subject: 'Ton mot de passe Noli a été modifié',
    html: layout([
      escapeHtml(hello),
      'Le mot de passe de ton compte Noli vient d’être modifié, et tes autres appareils ont été déconnectés.',
      'Si c’est toi, tu n’as rien à faire.',
      'Si ce n’est pas toi, demande tout de suite un nouveau code depuis l’écran « Mot de passe oublié » de l’app pour reprendre ton compte.',
    ]),
    text: [
      hello,
      '',
      'Le mot de passe de ton compte Noli vient d’être modifié, et tes autres appareils ont été déconnectés.',
      'Si c’est toi, tu n’as rien à faire.',
      'Si ce n’est pas toi, demande tout de suite un nouveau code depuis l’écran « Mot de passe oublié » de l’app pour reprendre ton compte.',
      '',
      'L’équipe Noli',
    ].join('\n'),
  };
}
