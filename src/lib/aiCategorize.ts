import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// AI-suggested Pareto categories (Google Gemini), via the categorize-remarks
// Supabase Edge Function — the API key lives only there, never in the
// browser. The function only SUGGESTS; nothing is written until a
// department admin reviews the suggestions in Insights and saves them.
// ---------------------------------------------------------------------------

export interface AiSuggestion {
  id: string;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface AiCategorizeRequest {
  employeeCode: string;
  departmentId: string;
  instruction: string;
  categories: string[];
  allowNew: boolean;
  items: { id: string; text: string }[];
}

export class AiNotConfiguredError extends Error {}

export async function suggestCategories(req: AiCategorizeRequest): Promise<{ model: string; results: AiSuggestion[] }> {
  const { data, error } = await supabase.functions.invoke('categorize-remarks', { body: req });
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
  return data as { model: string; results: AiSuggestion[] };
}

/** What the model reads for one entry: its reason and remark together. */
export function remarkText(reason: string, remarks: string): string {
  const parts = [];
  if (reason.trim()) parts.push(`Reason: ${reason.trim()}`);
  if (remarks.trim()) parts.push(`Remarks: ${remarks.trim()}`);
  return parts.join('\n');
}
