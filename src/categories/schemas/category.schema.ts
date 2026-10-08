import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { SLUG_PATTERN } from '../slugify';

@Schema({ timestamps: true })
export class Category extends Document {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 50 })
  name!: string;

  @Prop({ required: true, unique: true })
  nameKey!: string;

  @Prop({ required: true, unique: true, match: SLUG_PATTERN })
  slug!: string;

  @Prop({ type: String, default: null, maxlength: 300 })
  description!: string | null;

  @Prop({ type: String, default: null })
  imageUrl!: string | null;

  // Not unique on purpose: a reorder rewrites every position and would trip a
  // unique index halfway through. Ties are broken by createdAt, then _id.
  @Prop({ type: Number, required: true, min: 0, index: true })
  displayOrder!: number;

  @Prop({ type: Boolean, required: true, default: true })
  isVisible!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
