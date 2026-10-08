import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Noli API')
    .setDescription(
      `## API REST de la plateforme Noli\n\n` +
      `Noli est une plateforme de streaming de séries. Cette API gère :\n` +
      `- 🔐 **Authentification** — JWT (access + refresh token)\n` +
      `- 👤 **Utilisateurs** — inscription, profil, rôles\n` +
      `- 🎬 **Séries & épisodes** — CRUD, recherche, notation\n` +
      `- 📺 **Historique de visionnage** — suivi de progression\n` +
      `- 🎯 **Recommandations** — personnalisées et par genre\n` +
      `- 💳 **Billing** — paiements KkiaPay et webhook\n\n` +
      `### Authentification\n` +
      `Les endpoints protégés nécessitent un **Bearer token** JWT.\n` +
      `Obtenez-le via \`POST /auth/login\`, puis cliquez sur **Authorize** en haut à droite.`
    )
    .setVersion('1.0')
    .setContact('Noli Team', '', 'bouraimawadoud@gmail.com')
    .addServer('http://localhost:3000', 'Local')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Entrez votre JWT token',
        in: 'header'
      },
      'JWT-auth'
    )
    .build();

  return SwaggerModule.createDocument(app, config);
}
