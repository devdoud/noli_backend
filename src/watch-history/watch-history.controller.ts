import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
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
  ApiBody,
} from '@nestjs/swagger';
import { WatchHistoryService } from './watch-history.service';
import { AddToWatchHistoryDto } from './dto/add-to-watch-history.dto';
import {
  ContinueWatchingQueryDto,
  WatchHistoryQueryDto,
} from './dto/watch-history-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Watch History')
@ApiBearerAuth('JWT-auth')
@Controller('watch-history')
export class WatchHistoryController {
  constructor(private readonly watchHistoryService: WatchHistoryService) {}

  @ApiOperation({ summary: 'Add an episode to watch history' })
  @ApiResponse({ status: 201, description: 'Episode added to watch history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post('add')
  @UseGuards(JwtAuthGuard)
  async addToWatchHistory(
    @Request() req: any,
    @Body() addToWatchHistoryDto: AddToWatchHistoryDto,
  ) {
    const userId = req.user._id.toString();
    const result = await this.watchHistoryService.addToWatchHistory(
      userId,
      addToWatchHistoryDto,
    );

    return {
      message: 'Episode added to watch history',
      data: result,
    };
  }

  @ApiOperation({ summary: 'Get watch history (paginated)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Watch history returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get()
  @UseGuards(JwtAuthGuard)
  async getWatchHistory(
    @Request() req: any,
    @Query() query: WatchHistoryQueryDto,
  ) {
    const userId = req.user._id.toString();
    const result = await this.watchHistoryService.getWatchHistory(
      userId,
      query.page ?? 1,
      query.limit ?? 10,
    );

    return {
      message: 'Watch history retrieved',
      data: result,
    };
  }

  @ApiOperation({ summary: 'Get "Continue watching" list' })
  @ApiQuery({ name: 'limit', required: false, example: 5 })
  @ApiResponse({ status: 200, description: 'Continue watching list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('continue-watching')
  @UseGuards(JwtAuthGuard)
  async getContinueWatching(
    @Request() req: any,
    @Query() query: ContinueWatchingQueryDto,
  ) {
    const userId = req.user._id.toString();
    const result = await this.watchHistoryService.getContinueWatching(
      userId,
      query.limit ?? 5,
    );

    return {
      message: 'Continue watching retrieved',
      data: result,
    };
  }

  @ApiOperation({ summary: 'Update episode watch progress' })
  @ApiParam({ name: 'seriesId', description: 'Series ID' })
  @ApiParam({ name: 'episodeNumber', description: 'Episode number' })
  @ApiParam({ name: 'seasonNumber', description: 'Season number' })
  @ApiBody({
    schema: {
      properties: {
        progressPercentage: {
          type: 'number',
          example: 65,
          minimum: 0,
          maximum: 100,
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Progress updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Patch('progress/:seriesId/:episodeNumber/:seasonNumber')
  @UseGuards(JwtAuthGuard)
  async updateProgress(
    @Request() req: any,
    @Param('seriesId') seriesId: string,
    @Param('episodeNumber') episodeNumber: string,
    @Param('seasonNumber') seasonNumber: string,
    @Body() body: { progressPercentage: number },
  ) {
    const userId = req.user._id.toString();
    const result = await this.watchHistoryService.updateProgress(
      userId,
      seriesId,
      parseInt(episodeNumber),
      parseInt(seasonNumber),
      body.progressPercentage,
    );

    return {
      message: 'Progress updated',
      data: result,
    };
  }

  @ApiOperation({ summary: 'Remove an episode from watch history' })
  @ApiParam({ name: 'seriesId', description: 'Series ID' })
  @ApiParam({ name: 'episodeNumber', description: 'Episode number' })
  @ApiParam({ name: 'seasonNumber', description: 'Season number' })
  @ApiResponse({ status: 200, description: 'Episode removed from history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Delete(':seriesId/:episodeNumber/:seasonNumber')
  @UseGuards(JwtAuthGuard)
  async removeFromHistory(
    @Request() req: any,
    @Param('seriesId') seriesId: string,
    @Param('episodeNumber') episodeNumber: string,
    @Param('seasonNumber') seasonNumber: string,
  ) {
    const userId = req.user._id.toString();
    const result = await this.watchHistoryService.removeFromHistory(
      userId,
      seriesId,
      parseInt(episodeNumber),
      parseInt(seasonNumber),
    );

    return {
      message: 'Episode removed from history',
      data: result,
    };
  }

  @ApiOperation({ summary: 'Clear entire watch history' })
  @ApiResponse({ status: 200, description: 'Watch history cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Delete()
  @UseGuards(JwtAuthGuard)
  async clearWatchHistory(@Request() req: any) {
    const userId = req.user._id.toString();
    await this.watchHistoryService.clearWatchHistory(userId);

    return {
      message: 'Watch history cleared',
    };
  }
}
