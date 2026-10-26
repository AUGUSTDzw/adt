import { describe, it, expect } from 'vitest';
import { pickOData, buildODataQuery } from '../../../src/connectors/sac/tools/_helpers.js';

describe('pickOData', () => {
  it('returns only OData query options, excluding operation/modelId/etc.', () => {
    const picked = pickOData({
      $top: 10,
      operation: 'audit_export',
      modelId: 'x',
      $filter: 'a',
    });
    expect(picked).toEqual({ $top: 10, $filter: 'a' });
  });

  it('does not leak operation/modelId into the buildODataQuery query string', () => {
    const qs = buildODataQuery(
      pickOData({ $top: 10, operation: 'audit_export', modelId: 'x', $filter: 'a' }),
    );
    expect(qs).not.toContain('operation=');
    expect(qs).not.toContain('modelId=');
    expect(qs).toContain('$top=10');
    expect(qs).toContain('$filter=a');
  });

  it('respects a per-operation key subset', () => {
    const picked = pickOData(
      { $top: 5, $skip: 2, $filter: 'f', $orderby: 'x', $count: true, $format: 'json' },
      ['$top', '$skip', '$filter', '$format'],
    );
    expect(picked).toEqual({ $top: 5, $skip: 2, $filter: 'f', $format: 'json' });
  });
});
