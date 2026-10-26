/**
 * Smart Query Tool — Routes queries to the best SAC API endpoint
 * (adapted from reference src/tools/smart-query.ts).
 *
 * Adaptation: the ref's registerSmartQueryTool(server) called
 * server.tool("smart_query", ...). Here we expose a ToolRegistration
 * whose handler preserves the analyzeQuery + routing logic verbatim,
 * calling client.sacGet (instance method, mockable).
 */

import { z } from 'zod';
import type { SacClient } from '../sac-client.js';
import type { ToolRegistration } from '../../../core/types.js';
import { toolSuccess, toolError } from './_helpers.js';

type QueryType = 'relational' | 'analytical';

interface QueryAnalysis {
  type: QueryType;
  target: string;
  hasAggregation: boolean;
}

function analyzeQuery(query: string): QueryAnalysis {
  const upperQ = query.toUpperCase();
  const hasAggregation = ['SUM(', 'COUNT(', 'AVG(', 'GROUP BY'].some((k) =>
    upperQ.includes(k),
  );
  const fromMatch = query.match(/FROM\s+([^\s;]+)/i);
  const target = fromMatch ? fromMatch[1] : 'Unknown';
  return {
    type: hasAggregation ? 'analytical' : 'relational',
    target,
    hasAggregation,
  };
}

export function smartQueryTool(client: SacClient): ToolRegistration {
  return {
    name: 'smart-query',
    description:
      "Execute a SQL-like query against SAC. Auto-selects OData vs Widget Query based on query type.",
    inputSchema: {
      query: z.string().describe("SQL-like query, e.g. 'SELECT * FROM Story123'"),
      space_id: z.string().optional().describe('Space ID'),
      model_id: z.string().optional().describe('Model ID if not in FROM'),
    },
    handler: async (args) => {
      const { query } = args as { query: string; space_id?: string; model_id?: string };
      try {
        const analysis = analyzeQuery(query);
        const metadata = {
          original_query: query,
          analysis,
          routing: '',
          fallback_triggered: false,
        };

        if (analysis.type === 'analytical') {
          metadata.routing = 'Analytical endpoint (Widget Data)';

          if (analysis.target.includes(':')) {
            const [storyId, widgetId] = analysis.target.split(':');
            try {
              const result = await client.sacGet(
                `/api/v1/widgetquery/getWidgetData?storyId=${storyId}&widgetId=${widgetId}`,
              );
              return toolSuccess(result, metadata);
            } catch (err) {
              console.warn('Analytical route failed, falling back to relational...', err);
              metadata.fallback_triggered = true;
            }
          } else {
            return toolError("For analytical queries, specify FROM as 'StoryID:WidgetID'.");
          }
        }

        metadata.routing = 'Relational endpoint (OData)';

        let url = `/api/v1/${analysis.target}`;
        const knownEntities = ['Stories', 'Models', 'Users', 'Teams', 'Resources', 'Activities'];
        const match = knownEntities.find((e) =>
          analysis.target.toLowerCase().includes(e.toLowerCase()),
        );
        if (match) {
          url = `/api/v1/${match}`;
        }

        const result = await client.sacGet(url);
        return toolSuccess(result, metadata);
      } catch (err) {
        return toolError(err);
      }
    },
  };
}
