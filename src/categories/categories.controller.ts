import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CategoriesService } from './categories.service';
import { ImageRoute, ImageUpload } from '../media/image-route.decorators';
import {
  CategorySeriesQueryDto,
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/category.dto';

// Static routes (`all`, `order`) are declared before the `:slug` / `:id` ones
// so they are never captured as a parameter.
@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @ApiOperation({
    summary: 'Lister les catégories visibles (ordre d’affichage)',
  })
  @ApiResponse({ status: 200, description: 'Catégories visibles' })
  @Get()
  async listVisible() {
    return {
      message: 'Categories retrieved',
      categories: await this.categoriesService.listVisible(),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Lister toutes les catégories, masquées comprises (admin)',
  })
  @ApiResponse({ status: 200, description: 'Toutes les catégories' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @UseGuards(JwtAuthGuard)
  @Get('all')
  async listAll(@Request() req) {
    this.assertAdmin(req);
    return {
      message: 'All categories retrieved',
      categories: await this.categoriesService.listAll(),
    };
  }

  @ApiOperation({ summary: 'Obtenir une catégorie visible par son slug' })
  @ApiParam({ name: 'slug', example: 'comedie-romantique' })
  @ApiResponse({ status: 200, description: 'Catégorie trouvée' })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable ou masquée' })
  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    return {
      message: 'Category retrieved',
      category: await this.categoriesService.findVisibleBySlug(slug),
    };
  }

  @ApiOperation({
    summary: 'Séries d’une catégorie (paginé)',
    description:
      'Tri `newest` (défaut) ou `rating`. Les séries n’incluent pas les épisodes.',
  })
  @ApiParam({ name: 'slug', example: 'comedie-romantique' })
  @ApiResponse({ status: 200, description: 'Séries de la catégorie' })
  @ApiResponse({ status: 400, description: 'page, limit ou sort invalide' })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable ou masquée' })
  @Get(':slug/series')
  async getSeries(
    @Param('slug') slug: string,
    @Query() query: CategorySeriesQueryDto,
  ) {
    return {
      message: 'Category series retrieved',
      data: await this.categoriesService.getSeriesInCategory(slug, query),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Créer une catégorie (admin)' })
  @ApiResponse({
    status: 201,
    description: 'Catégorie créée, placée en dernier',
  })
  @ApiResponse({ status: 400, description: 'Nom invalide ou slug réservé' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({
    status: 409,
    description: 'Une catégorie avec ce nom existe déjà',
  })
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() dto: CreateCategoryDto, @Request() req) {
    this.assertAdmin(req);
    return {
      message: 'Category created',
      category: await this.categoriesService.create(dto),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Réordonner toutes les catégories (admin)',
    description:
      'Envoyer tous les ids, masqués compris, chacun une fois, dans le nouvel ordre.',
  })
  @ApiResponse({ status: 200, description: 'Nouvel ordre appliqué' })
  @ApiResponse({
    status: 400,
    description: 'Liste incomplète, inconnue ou en double',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @UseGuards(JwtAuthGuard)
  @Put('order')
  async reorder(@Body() dto: ReorderCategoriesDto, @Request() req) {
    this.assertAdmin(req);
    return {
      message: 'Categories reordered',
      categories: await this.categoriesService.reorder(dto),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Modifier une catégorie (admin)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Catégorie mise à jour' })
  @ApiResponse({
    status: 400,
    description: 'Aucun champ fourni ou valeur invalide',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable' })
  @ApiResponse({ status: 409, description: 'Nom ou slug déjà utilisé' })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Request() req,
  ) {
    this.assertAdmin(req);
    return {
      message: 'Category updated',
      category: await this.categoriesService.update(id, dto),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Supprimer une catégorie inutilisée (admin)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Catégorie supprimée' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable' })
  @ApiResponse({
    status: 409,
    description: 'Catégorie encore utilisée par des séries',
    schema: {
      example: {
        statusCode: 409,
        code: 'CATEGORY_IN_USE',
        message: 'Move or edit the series in this category before deleting it',
        seriesCount: 3,
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    this.assertAdmin(req);
    await this.categoriesService.remove(id);
    return { message: 'Category deleted' };
  }

  // Image routes (spec 0005): guards (401, shared 429), then Multer
  // (413/400), then the inline admin check.
  @ApiOperation({
    summary: 'Téléverser l’image d’une catégorie (admin)',
    description:
      'Champ multipart "file" : JPEG, PNG ou WebP, 5 Mo au plus, au moins 400 × 400 px. Recadrée en carré (800 px au plus). Remplace et supprime l’ancienne image.',
  })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Image mise à jour' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ImageRoute()
  @ImageUpload()
  @Put(':id/image')
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req,
  ) {
    this.assertAdmin(req);
    return {
      message: 'Category image updated',
      category: await this.categoriesService.setImage(id, file),
    };
  }

  @ApiOperation({ summary: 'Retirer l’image d’une catégorie (admin)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Image retirée' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ApiResponse({ status: 503, description: 'Service d’images indisponible' })
  @ImageRoute()
  @Delete(':id/image')
  async removeImage(@Param('id') id: string, @Request() req) {
    this.assertAdmin(req);
    return {
      message: 'Category image removed',
      category: await this.categoriesService.removeImage(id),
    };
  }

  private assertAdmin(req: { user?: { role?: string } }): void {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('Only admins can manage categories');
    }
  }
}
