import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsQueryDto } from './dto/recommendations-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { toPublicSeriesList } from '../series/content-access';

@ApiTags('Recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get personalized recommendations for the logged-in user',
  })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Personalized recommendations returned',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('for-me')
  @UseGuards(JwtAuthGuard)
  async getRecommendationsForMe(
    @Request() req: any,
    @Query() query: RecommendationsQueryDto,
  ) {
    const userId = req.user._id.toString();
    const recommendations =
      await this.recommendationsService.getRecommendations(
        userId,
        query.limit || 10,
      );

    return {
      message: 'Personalized recommendations retrieved',
      data: toPublicSeriesList(recommendations),
    };
  }

  @ApiOperation({ summary: 'Get popular series' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Popular series returned' })
  @Get('popular')
  async getPopularSeries(@Query() query: RecommendationsQueryDto) {
    const popular = await this.recommendationsService.getPopularSeries(
      query.limit || 10,
    );

    return {
      message: 'Popular series retrieved',
      data: toPublicSeriesList(popular),
    };
  }

  @ApiOperation({ summary: 'Get trending series' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Trending series returned' })
  @Get('trending')
  async getTrendingNow(@Query() query: RecommendationsQueryDto) {
    const trending = await this.recommendationsService.getTrendingNow(
      query.limit || 10,
    );

    return {
      message: 'Trending series retrieved',
      data: toPublicSeriesList(trending),
    };
  }

  @ApiOperation({ summary: 'Get top rated series' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Top rated series returned' })
  @Get('top-rated')
  async getTopRatedSeries(@Query() query: RecommendationsQueryDto) {
    const topRated = await this.recommendationsService.getTopRatedSeries(
      query.limit || 10,
    );

    return {
      message: 'Top rated series retrieved',
      data: toPublicSeriesList(topRated),
    };
  }

  @ApiOperation({ summary: 'Get new series' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'New series returned' })
  @Get('new')
  async getNewSeries(@Query() query: RecommendationsQueryDto) {
    const newSeries = await this.recommendationsService.getNewSeries(
      query.limit || 10,
    );

    return {
      message: 'New series retrieved',
      data: toPublicSeriesList(newSeries),
    };
  }

  @ApiOperation({ summary: 'Get series similar to a given one' })
  @ApiParam({
    name: 'seriesId',
    description: 'Series ID to find similar content for',
  })
  @ApiQuery({ name: 'limit', required: false, example: 5 })
  @ApiResponse({ status: 200, description: 'Similar series returned' })
  @Get('similar/:seriesId')
  async getSimilarSeries(
    @Param('seriesId') seriesId: string,
    @Query() query: RecommendationsQueryDto,
  ) {
    const similar = await this.recommendationsService.getSimilarSeries(
      seriesId,
      query.limit || 5,
    );

    return {
      message: 'Similar series retrieved',
      data: toPublicSeriesList(similar),
    };
  }

  @ApiOperation({ summary: 'Meilleures séries d’une catégorie' })
  @ApiParam({
    name: 'slug',
    description: 'Slug de catégorie',
    example: 'comedie-romantique',
  })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Category recommendations returned',
  })
  @ApiResponse({ status: 404, description: 'Catégorie introuvable ou masquée' })
  @Get('category/:slug')
  async getCategoryRecommendations(
    @Param('slug') slug: string,
    @Query() query: RecommendationsQueryDto,
  ) {
    const recommendations =
      await this.recommendationsService.getCategoryRecommendations(
        slug,
        query.limit || 10,
      );

    return {
      message: `Recommendations for category: ${slug}`,
      data: toPublicSeriesList(recommendations),
    };
  }
}
