import { ApiProperty } from '@nestjs/swagger';

class UserInTokenDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6789abcdef' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiProperty({ example: 'user', enum: ['user', 'admin'] })
  role: string;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'Login successful' })
  message: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;

  @ApiProperty({ type: UserInTokenDto })
  user: UserInTokenDto;
}

export class RefreshResponseDto {
  @ApiProperty({ example: 'Token refreshed' })
  message: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;
}
