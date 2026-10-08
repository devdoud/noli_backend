import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';
import { buildSwaggerDocument } from '../src/swagger.config';

async function generate() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildSwaggerDocument(app);

  writeFileSync('docs/openapi.json', JSON.stringify(document, null, 2));
  console.log('Wrote docs/openapi.json');

  await app.close();
  process.exit(0);
}

generate();
