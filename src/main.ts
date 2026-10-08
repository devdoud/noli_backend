import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { buildSwaggerDocument } from './swagger.config';

async function bootstrap() {
  // rawBody keeps the exact request bytes for webhook signatures (spec 0006);
  // JSON parsing is unchanged.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Behind a hosting proxy, req.ip is the proxy's address unless Express
  // trusts it; the password reset IP limits depend on the real client IP
  // (spec 0007). TRUST_PROXY is the number of proxies in front of the API.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', Number(trustProxy));
  } else if (process.env.NODE_ENV === 'production') {
    new Logger('Bootstrap').warn(
      'TRUST_PROXY is not set: behind a proxy every client shares one IP for rate limits',
    );
  }

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const document = buildSwaggerDocument(app);

  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Noli API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showExtensions: true,
      tryItOutEnabled: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha'
    }
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}
bootstrap();
