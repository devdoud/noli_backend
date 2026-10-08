import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { MediaService } from '../media/media.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly mediaService: MediaService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { email, username, password, firstName, lastName } = createUserDto;

    const existingEmail = await this.userModel.findOne({ email });
    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    const existingUsername = await this.userModel.findOne({ username });
    if (existingUsername) {
      throw new ConflictException('Username already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.userModel.create({
      email,
      username,
      password: hashedPassword,
      firstName,
      lastName,
      role: 'user',
      subscription: {
        plan: 'free',
        isActive: true,
        startDate: new Date()
      }
    });

    return user.toObject({ versionKey: false });
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.userModel.findOne({ email }).select('+password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findById(userId: string): Promise<User> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.toObject({ versionKey: false });
  }

  async verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    const isValid = await bcrypt.compare(plainPassword, hashedPassword);
    return isValid;
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().lean().exec();
  }

  // PUT /users/me/avatar (spec 0005 AC-4). The user is read fresh: req.user
  // is a snapshot taken by the JWT guard.
  async setAvatar(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<User> {
    const current = await this.findById(userId);
    return this.mediaService.replaceImage({
      file,
      slot: 'userAvatar',
      owner: { userId },
      currentUrl: current.avatar ?? null,
      save: (oldUrl, newUrl) => this.saveAvatar(userId, oldUrl, newUrl),
      exists: () => this.userExists(userId),
      notFoundMessage: 'User not found',
    });
  }

  // DELETE /users/me/avatar (spec 0005 AC-7).
  async removeAvatar(userId: string): Promise<User> {
    const current = await this.findById(userId);
    return this.mediaService.removeImage({
      slot: 'userAvatar',
      owner: { userId },
      current,
      currentUrl: current.avatar ?? null,
      save: (oldUrl) => this.saveAvatar(userId, oldUrl, null),
      exists: () => this.userExists(userId),
      notFoundMessage: 'User not found',
    });
  }

  private async saveAvatar(
    userId: string,
    oldUrl: string | null,
    newUrl: string | null,
  ): Promise<User | null> {
    return this.userModel
      .findOneAndUpdate(
        { _id: userId, avatar: oldUrl },
        { $set: { avatar: newUrl } },
        { new: true },
      )
      .lean()
      .exec() as Promise<User | null>;
  }

  private async userExists(userId: string): Promise<boolean> {
    return Boolean(await this.userModel.exists({ _id: userId }));
  }
}