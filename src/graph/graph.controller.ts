import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GraphQueryDto } from './dto/graph-query.dto';
import { GraphService } from './graph.service';
import { FilterSet, GraphResponse } from './graph.types';

@ApiTags('graph')
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get()
  @ApiOperation({
    summary: 'Query the service graph with optional path filters',
    description: 'Returns nodes and edges for paths satisfying every active filter (AND logic). Omitting a filter or passing false returns the full graph.',
  })
  @ApiQuery({ name: 'startsFromPublic', required: false, type: Boolean, description: 'Only paths originating from a node with publicExposed: true' })
  @ApiQuery({ name: 'endsAtSink', required: false, type: Boolean, description: 'Only paths terminating at a node with kind rds or sqs' })
  @ApiQuery({ name: 'hasVulnerability', required: false, type: Boolean, description: 'Only paths where at least one node has non-empty vulnerabilities' })
  
  query(@Query() dto: GraphQueryDto): GraphResponse {
    const filters: FilterSet = {
      startsFromPublic: dto.startsFromPublic ?? false,
      endsAtSink: dto.endsAtSink ?? false,
      hasVulnerability: dto.hasVulnerability ?? false,
    };
    return this.graphService.query(filters);
  }
}
