import { Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  isEmailVerified: boolean;
  tokenVersion?: number;
  role: 'user' | 'admin';
  subscription: {
    plan: 'free' | 'premium';
    startDate: Date;
    endDate?: Date;
    isActive: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}