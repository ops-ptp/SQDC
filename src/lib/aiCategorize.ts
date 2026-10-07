import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// AI-suggested Pareto tags (Google Gemini), via the categorize-remarks
// Supabase Edge Function — the API key lives only there, never in the
// browser. The function only SUGGESTS; nothing is written until a
// department admin reviews the suggestions in Insights and saves them.
//
// One run can look at a remark from several ANGLES at once (Cause,
// Equipment, Location…). Each angle allows one tag per remark, or up to
// three when the angle is set to multi-tag.
// ---------------------------------------------------------------------------

export type AiConfidence = 'high' | 'medium' | 'low';

export interface AiTag {
  category: string;
  confidence: AiConfidence;
}

export interface AiAngleResult {
  tags: AiTag[];
  reason: string;
}

export interface AiSuggestion {
  id: string;
  /** Keyed by angle name. */
  angles: Record<string, AiAngleResult>;
}

export interface AiAngleRequest {
  name: string;
  categories: string[];
  allowNew: boolean;
  multi: boolean;
}

export interface AiCategorizeRequest {
  employeeCode: string;
  departmentId: string;
  instruction: string;
  angles: AiAngleRequest[];
  items: { id: string; text: string }[];
}

export const MAX_AI_ANGLES = 5;
export const MAX_AI_TAGS = 3;

export class AiNotConfiguredError extends Error {}

export async function suggestCategories(req: AiCategorizeRequest, signal?: AbortSignal): Promise<{ model: string; results: AiSuggestion[] }> {
  const { data, error } = await supabase.functions.invoke('categorize-remarks', { body: req, signal });
  if (error) {
    // FunctionsHttpError carries the function's own JSON response.
    const ctx = (error as { context?: Response }).context;
    let body: { error?: string; message?: string } | null = null;
    if (ctx && typeof ctx.json === 'function') {
      try {
        body = await ctx.json();
      } catch {
        body = null;
      }
    }
    if (body?.error === 'not_configured') throw new AiNotConfiguredError(body.message ?? 'AI categorisation is not configured.');
    throw new Error(body?.message ?? error.message ?? 'AI categorisation failed');
  }
  const res = data as { model: string; results: AiSuggestion[] };
  if (!Array.isArray(res?.results) || (res.results[0] && !res.results[0].angles)) {
    // An older deployment of the function answered in the single-category shape.
    throw new Error('The AI function on the server is an older version — ask a site admin to redeploy categorize-remarks.');
  }
  return res;
}

/** What the model reads for one entry: its reason and remark together. */
export function remarkText(reason: string, remarks: string): string {
  const parts = [];
  if (reason.trim()) parts.push(`Reason: ${reason.trim()}`);
  if (remarks.trim()) parts.push(`Remarks: ${remarks.trim()}`);
  return parts.join('\n');
}
