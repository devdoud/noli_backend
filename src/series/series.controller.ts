import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
  ParseIntPipe,
  Put,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { SeriesService } from './series.service';
import { CreateSeriesDto } from './dto/create-series.dto';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateSeriesAccessDto } from './dto/update-series-access.dto';
import { UpdateSeriesDto } from './dto/update-series.dto';
import { UpdateEpisodeDto } from './dto/update-episode.dto';
import {
  ImportVideoDto,
  RequestVideoUploadDto,
} from './dto/episode-video.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  toAdminSeries,
  toPublicSeries,
  toPublicSeriesList,
} from './content-access';
import { ImageRoute, ImageUpload } from '../media/image-route.decorators';

@ApiTags('Series')
@Controller('series')
export class SeriesController {
  constructor(private seriesService: SeriesService) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new series (admin only)' })
  @ApiResponse({ status: 201, description: 'Series created successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @UseGuards(JwtAuthGuard)
  @Post()
  async createSeries(@Body() createSeriesDto: CreateSeriesDto, @Request() req) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can create series');
    }

    const series = await this.seriesService.createSeries(createSeriesDto);

    return {
      message: 'Series created successfully',
      series: toAdminSeries(series),
    };
  }

  @ApiOperation({ summary: 'Get all series (paginated)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Series list returned' })
  @Get()
  async getAllSeries(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const result = await this.seriesService.getAllSeries(page, limit);

    return {
      message: 'Series retrieved successfully',
      data: { ...result, series: toPublicSeriesList(result.series) },
    };
  }

  @ApiOperation({ summary: 'Get trending series' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Trending series returned' })
  @Get('trending')
  async getTrendingSeries(@Query('limit') limit: number = 10) {
    const series = await this.seriesService.getTrendingSeries(limit);

    return {
      message: 'Trending series retrieved',
      series: toPublicSeriesList(series),
    };
  }

  @ApiOperation({ summary: 'Search series by title' })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Search query',
    example: 'breaking',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Search results returned' })
  @Get('search')
  async searchSeries(
    @Query('q') query: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const result = await this.seriesService.searchSeries(query, page, limit);

    return {
      message: 'Search results',
      data: { ...result, series: toPublicSeriesList(result.series) },
    };
  }

  @ApiOperation({
    summary: 'Get series by ID',
    description:
      'Les épisodes incluent `isFree` mais jamais `videoUrl` : utiliser la route `/play` pour lire un épisode.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Series found' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @Get(':id')
  async getSeriesById(@Param('id') id: string) {
    const series = await this.seriesService.getSeriesById(id);

    return {
      message: 'Series retrieved successfully',
      series: toPublicSeries(series, { playableOnly: true }),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Lire un épisode (retourne le lien vidéo)',
    description:
      "Seul endpoint qui retourne `videoUrl`. Gratuit si la série est gratuite ou si l'épisode fait partie des `freeEpisodeCount` premiers épisodes lisibles (ordre saison puis épisode). Sinon, abonnement premium actif requis. Vidéo Cloudflare : `type: 'hls'`, `videoUrl` est un lien HLS (.m3u8) signé qui expire à `expiresAt` (2 × la durée + 1 h) ; redemander ce lien si le lecteur reçoit 401/403 ou à la reprise. Ancien lien collé : `type: 'direct'`, `expiresAt: null`.",
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 200, description: 'Lien vidéo retourné' })
  @ApiResponse({
    status: 400,
    description: 'Numéro de saison ou d’épisode invalide',
  })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({
    status: 403,
    description: 'Abonnement premium requis',
    schema: {
      example: {
        statusCode: 403,
        code: 'PREMIUM_REQUIRED',
        message: 'Premium subscription required',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Série ou épisode introuvable, ou épisode sans vidéo prête',
  })
  @ApiResponse({ status: 503, description: 'Lecture vidéo indisponible' })
  @UseGuards(JwtAuthGuard)
  @Get(':id/episodes/:seasonNumber/:episodeNumber/play')
  async playEpisode(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Request() req,
  ) {
    const data = await this.seriesService.getPlayableEpisode(
      id,
      seasonNumber,
      episodeNumber,
      req.user,
    );

    return {
      message: 'Episode ready to play',
      data,
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Changer l’accès premium d’une série (admin uniquement)',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Accès mis à jour' })
  @ApiResponse({
    status: 400,
    description: 'Aucun champ fourni ou valeur invalide',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @UseGuards(JwtAuthGuard)
  @Patch(':id/access')
  async updateAccess(
    @Param('id') id: string,
    @Body() dto: UpdateSeriesAccessDto,
    @Request() req,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can change series access');
    }

    const series = await this.seriesService.updateAccess(id, dto);

    return {
      message: 'Series access updated',
      series: toAdminSeries(series),
    };
  }

  @ApiOperation({ summary: 'Get episodes of a series (paginated)' })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Episodes returned' })
  @Get(':id/episodes')
  async getEpisodes(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const result = await this.seriesService.getEpisodes(id, page, limit);

    return {
      message: 'Episodes retrieved successfully',
      data: result,
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Add an episode to a series (admin only)' })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 201, description: 'Episode added successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @UseGuards(JwtAuthGuard)
  @Post(':id/episodes')
  async addEpisode(
    @Param('id') id: string,
    @Body() createEpisodeDto: CreateEpisodeDto,
    @Request() req,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can add episodes');
    }

    const series = await this.seriesService.addEpisode(id, createEpisodeDto);

    return {
      message: 'Episode added successfully',
      series: toAdminSeries(series),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Rate a series' })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiBody({
    schema: {
      properties: {
        rating: { type: 'number', example: 4.5, minimum: 0, maximum: 5 },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Series rated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post(':id/rate')
  async rateSeries(@Param('id') id: string, @Body() body: { rating: number }) {
    const series = await this.seriesService.rateSeries(id, body.rating);

    return {
      message: 'Series rated successfully',
      series: toPublicSeries(series, { playableOnly: true }),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Modifier une série (admin uniquement)',
    description:
      'Tous les champs sont optionnels : titre, description, images, langues, pays, année, statut, catégories, accès premium. note, votes et épisodes ne sont pas modifiables ici.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Série mise à jour' })
  @ApiResponse({
    status: 400,
    description: 'Aucun champ fourni ou valeur invalide',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @ApiResponse({
    status: 409,
    description: 'Titre déjà utilisé par une autre série',
  })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateSeries(
    @Param('id') id: string,
    @Body() dto: UpdateSeriesDto,
    @Request() req,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can edit series');
    }

    const series = await this.seriesService.updateSeries(id, dto);

    return {
      message: 'Series updated',
      series: toAdminSeries(series),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Modifier un épisode (admin uniquement)',
    description:
      'Saison et numéro d’épisode sont figés. Renommer un épisode met aussi à jour le titre dans l’historique des utilisateurs.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 200, description: 'Épisode mis à jour' })
  @ApiResponse({
    status: 400,
    description: 'Aucun champ fourni ou valeur invalide',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @UseGuards(JwtAuthGuard)
  @Patch(':id/episodes/:seasonNumber/:episodeNumber')
  async updateEpisode(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Body() dto: UpdateEpisodeDto,
    @Request() req,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can edit episodes');
    }

    const series = await this.seriesService.updateEpisode(
      id,
      seasonNumber,
      episodeNumber,
      dto,
    );

    return {
      message: 'Episode updated',
      series: toAdminSeries(series),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Supprimer un épisode (admin uniquement)',
    description:
      'Suppression définitive. L’épisode est aussi retiré de l’historique de tous les utilisateurs. Le nombre d’épisodes gratuits reste le même (la limite se décale).',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 200, description: 'Épisode supprimé' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @UseGuards(JwtAuthGuard)
  @Delete(':id/episodes/:seasonNumber/:episodeNumber')
  async deleteEpisode(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Request() req,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can delete episodes');
    }

    const series = await this.seriesService.deleteEpisode(
      id,
      seasonNumber,
      episodeNumber,
    );

    return {
      message: 'Episode deleted',
      series: toAdminSeries(series),
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete a series (admin only)',
    description: 'Also removes the series from every user’s watch history.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Series deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteSeries(@Param('id') id: string, @Request() req) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can delete series');
    }

    const result = await this.seriesService.deleteSeries(id);

    return result;
  }

  // Image routes (spec 0005). Guards run first (401, then the shared 429),
  // then Multer reads the file (413/400), then ParseIntPipe, then the inline
  // admin check.

  @ApiOperation({
    summary: 'Téléverser la couverture d’une série (admin uniquement)',
    description:
      'Champ multipart "file" : JPEG, PNG ou WebP, 5 Mo au plus, au moins 400 × 600 px. Recadrée en 2:3 (1000 px de large au plus). Remplace et supprime l’ancienne image.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Couverture mise à jour' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ImageRoute()
  @ImageUpload()
  @Put(':id/cover')
  async uploadCover(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const series = await this.seriesService.setSeriesImage(id, 'coverImage', file);
    return { message: 'Series cover updated', series: toAdminSeries(series) };
  }

  @ApiOperation({ summary: 'Retirer la couverture d’une série (admin uniquement)' })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Couverture retirée' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ApiResponse({ status: 503, description: 'Service d’images indisponible' })
  @ImageRoute()
  @Delete(':id/cover')
  async removeCover(@Param('id') id: string, @Request() req) {
    this.assertAdmin(req);
    const series = await this.seriesService.removeSeriesImage(id, 'coverImage');
    return { message: 'Series cover removed', series: toAdminSeries(series) };
  }

  @ApiOperation({
    summary: 'Téléverser la bannière d’une série (admin uniquement)',
    description:
      'Champ multipart "file" : JPEG, PNG ou WebP, 5 Mo au plus, au moins 1280 × 720 px. Recadrée en 16:9 (1920 px de large au plus). Remplace et supprime l’ancienne image.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Bannière mise à jour' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ImageRoute()
  @ImageUpload()
  @Put(':id/banner')
  async uploadBanner(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const series = await this.seriesService.setSeriesImage(id, 'bannerImage', file);
    return { message: 'Series banner updated', series: toAdminSeries(series) };
  }

  @ApiOperation({ summary: 'Retirer la bannière d’une série (admin uniquement)' })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Bannière retirée' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ApiResponse({ status: 503, description: 'Service d’images indisponible' })
  @ImageRoute()
  @Delete(':id/banner')
  async removeBanner(@Param('id') id: string, @Request() req) {
    this.assertAdmin(req);
    const series = await this.seriesService.removeSeriesImage(id, 'bannerImage');
    return { message: 'Series banner removed', series: toAdminSeries(series) };
  }

  @ApiOperation({
    summary: 'Téléverser la vignette d’un épisode (admin uniquement)',
    description:
      'Champ multipart "file" : JPEG, PNG ou WebP, 5 Mo au plus, au moins 640 × 360 px. Recadrée en 16:9 (1280 px de large au plus).',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 200, description: 'Vignette mise à jour' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ImageRoute()
  @ImageUpload()
  @Put(':id/episodes/:seasonNumber/:episodeNumber/thumbnail')
  async uploadEpisodeThumbnail(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const series = await this.seriesService.setEpisodeThumbnail(
      id,
      seasonNumber,
      episodeNumber,
      file,
    );
    return { message: 'Episode thumbnail updated', series: toAdminSeries(series) };
  }

  @ApiOperation({ summary: 'Retirer la vignette d’un épisode (admin uniquement)' })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 200, description: 'Vignette retirée' })
  @ApiResponse({ status: 400, description: 'Saison ou épisode non entier' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @ApiResponse({ status: 409, description: 'L’image a changé entre temps' })
  @ApiResponse({ status: 503, description: 'Service d’images indisponible' })
  @ImageRoute()
  @Delete(':id/episodes/:seasonNumber/:episodeNumber/thumbnail')
  async removeEpisodeThumbnail(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const series = await this.seriesService.removeEpisodeThumbnail(
      id,
      seasonNumber,
      episodeNumber,
    );
    return { message: 'Episode thumbnail removed', series: toAdminSeries(series) };
  }

  // Episode videos (spec 0006). Write routes share the per user limit of the
  // image routes; the admin check is the first thing in each handler.

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Voir une série côté admin (tous les épisodes et leur vidéo)',
    description:
      'Contrairement à GET /series/:id, inclut les épisodes sans vidéo prête, avec pour chacun `video.status` (ready, pending, error, legacy, none). Les liens d’envoi inutilisés et expirés passent en erreur au passage.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiResponse({ status: 200, description: 'Série complète' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  @UseGuards(JwtAuthGuard)
  @Get(':id/admin')
  async getSeriesForAdmin(@Param('id') id: string, @Request() req) {
    this.assertAdmin(req);
    const series = await this.seriesService.getSeriesForAdmin(id);
    return { message: 'Series retrieved for admin', series: toAdminSeries(series) };
  }

  @ApiOperation({
    summary: 'Obtenir un lien d’envoi vidéo pour un épisode (admin)',
    description:
      'Retourne un lien à usage unique vers Cloudflare Stream, valable un peu moins de 6 h, pour une vidéo de 3 h au plus. method "post" (fichier ≤ 200 Mo) : envoyer le fichier en multipart (champ "file") en POST sur uploadUrl. method "tus" (> 200 Mo) : envoyer avec un client tus (morceaux multiples de 256 Kio, au moins 5 Mio sauf le dernier), reprenable en cas de coupure. L’épisode garde sa vidéo actuelle jusqu’à ce que la nouvelle soit prête.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiBody({ type: RequestVideoUploadDto })
  @ApiResponse({ status: 201, description: '{ method, uploadUrl, uid, expiresAt }' })
  @ApiResponse({ status: 400, description: 'Taille invalide, saison ou épisode non entier' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @ApiResponse({ status: 409, description: 'Une autre demande a été traitée entre temps' })
  @ApiResponse({ status: 503, description: 'Service vidéo indisponible' })
  @ImageRoute()
  @Post(':id/episodes/:seasonNumber/:episodeNumber/video/upload')
  async requestVideoUpload(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Body() dto: RequestVideoUploadDto,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const ticket = await this.seriesService.requestVideoUpload(
      id,
      seasonNumber,
      episodeNumber,
      dto.uploadLength,
    );
    return { message: 'Video upload link created', ...ticket };
  }

  @ApiOperation({
    summary: 'Importer la vidéo d’un épisode depuis un lien (admin)',
    description:
      'Cloudflare télécharge lui même le fichier depuis un lien public https (par exemple là où la vidéo est hébergée aujourd’hui). Un lien inaccessible finit plus tard en `pendingStatus: error`.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiBody({ type: ImportVideoDto })
  @ApiResponse({ status: 201, description: '{ uid, pendingStatus: processing }' })
  @ApiResponse({ status: 400, description: 'Lien invalide (https requis) ou refusé par Cloudflare' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @ApiResponse({ status: 409, description: 'Une autre demande a été traitée entre temps' })
  @ApiResponse({ status: 503, description: 'Service vidéo indisponible' })
  @ImageRoute()
  @Post(':id/episodes/:seasonNumber/:episodeNumber/video/import')
  async importVideo(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Body() dto: ImportVideoDto,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const hasUrl = dto.url !== undefined;
    if (hasUrl === (dto.fromPastedLink === true)) {
      throw new BadRequestException('Donnez url ou fromPastedLink');
    }
    const result = await this.seriesService.importVideo(
      id,
      seasonNumber,
      episodeNumber,
      dto.url ?? null,
    );
    return { message: 'Video import started', ...result };
  }

  @ApiOperation({
    summary: 'Rafraîchir l’état de la vidéo d’un épisode (admin)',
    description:
      'Demande directement à Cloudflare où en est la vidéo en attente (si un webhook a été manqué, ou en développement local), et expire un lien d’envoi inutilisé.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 201, description: 'Série (vue admin) à jour' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @ApiResponse({ status: 503, description: 'Service vidéo indisponible' })
  @ImageRoute()
  @Post(':id/episodes/:seasonNumber/:episodeNumber/video/refresh')
  async refreshVideo(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const series = await this.seriesService.refreshVideo(id, seasonNumber, episodeNumber);
    return { message: 'Video status refreshed', series: toAdminSeries(series) };
  }

  @ApiOperation({
    summary: 'Retirer la vidéo d’un épisode (admin)',
    description:
      'Retire la vidéo actuelle, celle en attente et un éventuel ancien lien collé, puis les supprime chez Cloudflare. L’épisode n’est plus visible des spectateurs.',
  })
  @ApiParam({ name: 'id', description: 'Series ID' })
  @ApiParam({ name: 'seasonNumber', example: 1 })
  @ApiParam({ name: 'episodeNumber', example: 1 })
  @ApiResponse({ status: 200, description: 'Vidéo retirée' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  @ApiResponse({ status: 404, description: 'Série ou épisode introuvable' })
  @ImageRoute()
  @Delete(':id/episodes/:seasonNumber/:episodeNumber/video')
  async removeVideo(
    @Param('id') id: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
    @Request() req,
  ) {
    this.assertAdmin(req);
    const series = await this.seriesService.removeVideo(id, seasonNumber, episodeNumber);
    return { message: 'Episode video removed', series: toAdminSeries(series) };
  }

  private assertAdmin(req: { user: { role?: string } }): void {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can manage series media');
    }
  }
}
