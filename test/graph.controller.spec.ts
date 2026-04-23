import { Test, TestingModule } from '@nestjs/testing';
import { GraphController } from '../src/graph/graph.controller';
import { GraphService } from '../src/graph/graph.service';
import { FilterSet, GraphResponse } from '../src/graph/graph.types';
import { GraphQueryDto } from '../src/graph/dto/graph-query.dto';

const EMPTY_RESPONSE: GraphResponse = { nodes: [], edges: [] };

const mockGraphService = {
  query: jest.fn<GraphResponse, [FilterSet]>().mockReturnValue(EMPTY_RESPONSE),
};

describe('GraphController', () => {
  let controller: GraphController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GraphController],
      providers: [{ provide: GraphService, useValue: mockGraphService }],
    }).compile();

    controller = module.get<GraphController>(GraphController);
  });

  describe('query()', () => {
    it('calls graphService.query with all filters false when no params are provided', () => {
      const dto = new GraphQueryDto();
      controller.query(dto);
      expect(mockGraphService.query).toHaveBeenCalledWith<[FilterSet]>({
        startsFromPublic: false,
        endsAtSink: false,
        hasVulnerability: false,
      });
    });

    it('maps startsFromPublic=true to FilterSet.startsFromPublic=true', () => {
      const dto = new GraphQueryDto();
      dto.startsFromPublic = true;
      controller.query(dto);
      expect(mockGraphService.query).toHaveBeenCalledWith(
        expect.objectContaining({ startsFromPublic: true }),
      );
    });

    it('maps endsAtSink=true to FilterSet.endsAtSink=true', () => {
      const dto = new GraphQueryDto();
      dto.endsAtSink = true;
      controller.query(dto);
      expect(mockGraphService.query).toHaveBeenCalledWith(
        expect.objectContaining({ endsAtSink: true }),
      );
    });

    it('maps hasVulnerability=true to FilterSet.hasVulnerability=true', () => {
      const dto = new GraphQueryDto();
      dto.hasVulnerability = true;
      controller.query(dto);
      expect(mockGraphService.query).toHaveBeenCalledWith(
        expect.objectContaining({ hasVulnerability: true }),
      );
    });

    it('maps startsFromPublic=false to FilterSet.startsFromPublic=false (filter inactive)', () => {
      const dto = new GraphQueryDto();
      dto.startsFromPublic = false;
      controller.query(dto);
      expect(mockGraphService.query).toHaveBeenCalledWith(
        expect.objectContaining({ startsFromPublic: false }),
      );
    });

    it('treats absent params as false via nullish coalescing', () => {
      const dto = new GraphQueryDto();
      controller.query(dto);
      const call = mockGraphService.query.mock.calls[0][0];
      expect(call.startsFromPublic).toBe(false);
      expect(call.endsAtSink).toBe(false);
      expect(call.hasVulnerability).toBe(false);
    });

    it('passes all three filters as true when all params are true', () => {
      const dto = new GraphQueryDto();
      dto.startsFromPublic = true;
      dto.endsAtSink = true;
      dto.hasVulnerability = true;
      controller.query(dto);
      expect(mockGraphService.query).toHaveBeenCalledWith<[FilterSet]>({
        startsFromPublic: true,
        endsAtSink: true,
        hasVulnerability: true,
      });
    });

    it('returns whatever graphService.query returns', () => {
      const fakeResponse: GraphResponse = {
        nodes: [{ name: 'x', kind: 'service' }],
        edges: [{ from: 'x', to: 'y' }],
      };
      mockGraphService.query.mockReturnValueOnce(fakeResponse);
      const dto = new GraphQueryDto();
      const result = controller.query(dto);
      expect(result).toBe(fakeResponse);
    });

    it('calls graphService.query exactly once per request', () => {
      controller.query(new GraphQueryDto());
      expect(mockGraphService.query).toHaveBeenCalledTimes(1);
    });
  });
});
