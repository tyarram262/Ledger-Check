import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/queries";
import type { FilingStatus } from "@/lib/taxRates";

const FILING_STATUSES: FilingStatus[] = ["single", "married_joint", "married_separate", "head_of_household"];

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const errors: string[] = [];

  const threshold = Number(body?.concentrationThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
    errors.push("Threshold must be a number between 0 and 100.");
  }

  const filingStatus = body?.filingStatus;
  if (!FILING_STATUSES.includes(filingStatus)) {
    errors.push("Filing status must be one of: " + FILING_STATUSES.join(", ") + ".");
  }

  const annualTaxableIncome = Number(body?.annualTaxableIncome);
  if (!Number.isFinite(annualTaxableIncome) || annualTaxableIncome < 0) {
    errors.push("Annual taxable income must be a non-negative number.");
  }

  const stateTaxRate = Number(body?.stateTaxRate);
  if (!Number.isFinite(stateTaxRate) || stateTaxRate < 0 || stateTaxRate > 100) {
    errors.push("State tax rate must be a number between 0 and 100.");
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  await updateSettings({
    concentrationThreshold: threshold,
    filingStatus: filingStatus as FilingStatus,
    annualTaxableIncome,
    stateTaxRate,
  });
  return NextResponse.json(await getSettings());
}
