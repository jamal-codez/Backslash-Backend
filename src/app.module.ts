import { Module } from '@nestjs/common';
import { GraphModule } from './graph/graph.module';

@Module({
  imports: [GraphModule],
})
export class AppModule {}
