import { AuditReport } from '../types.js';

export function formatJsonReport(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
