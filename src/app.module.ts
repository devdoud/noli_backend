import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module'
import { SeriesModule } from './series/series.module';
import { WatchHistoryModule } from './watch-history/watch-history.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { BillingModule } from './billing/billing.module';
import { CategoriesModule } from './categories/categories.module';
import { throttlerOptions } from './throttler.config';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get('MONGODB_URI'),
      })
    }),

    ScheduleModule.forRoot(),

    // Global: one in memory counter store for every throttled route.
    ThrottlerModule.forRoot(throttlerOptions),

    UsersModule,
    AuthModule,
    SeriesModule,
    WatchHistoryModule,
    RecommendationsModule,
    BillingModule,
    CategoriesModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}