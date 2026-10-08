import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from './schemas/category.schema';
import { Series, SeriesSchema } from '../series/schemas/series.schema';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { MediaModule } from '../media/media.module';

// Exports MongooseModule so SeriesModule and RecommendationsModule get the
// Category model: populate resolves models by name and throws
// MissingSchemaError if Category isn't registered where it runs.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Series.name, schema: SeriesSchema },
    ]),
    MediaModule,
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [MongooseModule, CategoriesService],
})
export class CategoriesModule {}
