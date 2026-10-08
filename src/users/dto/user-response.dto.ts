import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SubscriptionDto {
  @ApiProperty({ example: 'free', enum: ['free', 'premium'] })
  plan: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  startDate?: Date;

  @ApiPropertyOptional({ example: '2027-09-01T00:00:00.000Z' })
  endDate?: Date;
}

export class UserDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6789abcdef' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiPropertyOptional({ example: 'John' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  lastName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  avatar?: string;

  @ApiProperty({ example: 'user', enum: ['user', 'admin'] })
  role: string;

  @ApiProperty({ type: SubscriptionDto })
  subscription: SubscriptionDto;

  @ApiProperty({ example: '2026-09-13T10:00:00.000Z' })
  createdAt: Date;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'User registered successfully' })
  message: string;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}

export class UsersListResponseDto {
  @ApiProperty({ example: 42 })
  count: number;

  @ApiProperty({ type: [UserDto] })
  users: UserDto[];
}
