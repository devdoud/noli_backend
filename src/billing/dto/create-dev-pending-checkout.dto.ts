import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDevPendingCheckoutDto {
  @ApiProperty({
    example: 1000,
    minimum: 1,
    description: 'Montant attendu pour ce paiement KkiaPay',
  })
  @IsNumber()
  @Min(1)
  expectedAmount!: number;
}
