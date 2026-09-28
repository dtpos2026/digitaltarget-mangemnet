// Project money + progress + next action, from the records already linked
// to a project (invoices.projectId, accounting.projectId,
// assignments.projectId, schedule.projectId). Nothing is estimated: when a
// link is missing the number is simply 0.
import { invoiceView } from "./invoice";
import { isExpense } from "./finance";
import { parseDT } from "./db";

export interface ProjectMetrics {
  budget: number;
  billed: number;
  paid: number;
  due: number;
  cost: number; // linked expenses + team assignment rates
  profit: number; // paid − cost (cash profit so far)
  expectedProfit: number; // max(budget, billed) − cost
  paymentStatus: "No invoice" | "Unpaid" | "Partial" | "Paid";
  tasks: number;
  tasksDone: number;
  progress: number; // 0–100
  team: string[];
  daysLeft: number | null;
  nextAction: string;
  urgency: "high" | "medium" | "low";
}

const DONE_TASK = new Set(["Done", "Completed", "Complete", "Approved", "Paid"]);
const num = (v: unknown) => Number(v) || 0;

export function projectMetrics(p: any, data: any, now = new Date()): ProjectMetrics {
  const invoices = (data.invoices || []).filter((i: any) => i.projectId === p.id).map((i: any) => invoiceView(i));
  const billed = invoices.reduce((s: number, v: any) => s + v.grandTotal, 0);
  const paid = invoices.reduce((s: number, v: any) => s + v.paid, 0);
  const due = invoices.reduce((s: number, v: any) => s + v.due, 0);
  const assignments = (data.assignments || []).filter((a: any) => a.projectId === p.id);
  const schedule = (data.schedule || []).filter((s: any) => s.projectId === p.id);
  const expenseRows = (data.accounting || []).filter((a: any) => a.projectId === p.id && isExpense(a));
  // Team cost: a paid assignment usually also has an accounting row; count the
  // rate only when no expense row is linked to this project for it.
  const paidByAccounting = new Set(expenseRows.map((a: any) => a.assignmentId).filter(Boolean));
  const teamCost = assignments.filter((a: any) => !paidByAccounting.has(a.id)).reduce((s: number, a: any) => s + num(a.rate), 0);
  const cost = expenseRows.reduce((s: number, a: any) => s + num(a.amount), 0) + teamCost;
  const budget = num(p.budget);

  const tasks = assignments.length + schedule.length;
  const tasksDone = assignments.filter((a: any) => DONE_TASK.has(a.status)).length + schedule.filter((s: any) => DONE_TASK.has(s.status)).length;
  const closed = p.status === "Complete" || p.status === "Done";
  const progress = closed ? 100 : tasks ? Math.round((tasksDone / tasks) * 100) : 0;
  const team = Array.from(new Set(assignments.map((a: any) => (data.team || []).find((t: any) => t.id === a.memberId)?.name).filter(Boolean))) as string[];

  const end = parseDT(p.end);
  const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86400000) : null;
  const paymentStatus: ProjectMetrics["paymentStatus"] = !invoices.length ? "No invoice" : due <= 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";

  let nextAction = "Sab theek — agla milestone update karein";
  let urgency: ProjectMetrics["urgency"] = "low";
  const openTasks = tasks - tasksDone;
  if (!closed && daysLeft !== null && daysLeft < 0) {
    nextAction = `Deadline ${Math.abs(daysLeft)} din guzar gayi — client ko nai date batayein ya kaam close karein`; urgency = "high";
  } else if (closed && due > 0) {
    nextAction = `Kaam mukammal — Rs ${Math.round(due).toLocaleString("en-PK")} baqi, payment reminder bhejein`; urgency = "high";
  } else if (!invoices.length && budget > 0) {
    nextAction = "Is project ki invoice nahi bani — invoice bana kar advance lein"; urgency = "medium";
  } else if (budget > 0 && cost > budget) {
    nextAction = `Cost budget se Rs ${Math.round(cost - budget).toLocaleString("en-PK")} zyada — kharcha rokein ya client se extra charge karein`; urgency = "high";
  } else if (!closed && daysLeft !== null && daysLeft <= 2 && openTasks > 0) {
    nextAction = `${daysLeft} din baqi aur ${openTasks} kaam pending — team se update lein`; urgency = "high";
  } else if (!closed && !assignments.length) {
    nextAction = "Koi team member assign nahi — Assignments mein kaam dein"; urgency = "medium";
  } else if (!closed && openTasks === 0 && tasks > 0) {
    nextAction = "Tamam tasks done — project Complete mark karein aur client se review lein"; urgency = "medium";
  } else if (due > 0 && paid === 0) {
    nextAction = "Advance abhi tak nahi aaya — payment follow-up karein"; urgency = "medium";
  }

  const top = Math.max(budget, billed);
  return {
    budget, billed, paid, due, cost, profit: paid - cost, expectedProfit: top - cost, paymentStatus,
    tasks, tasksDone, progress, team, daysLeft, nextAction, urgency,
  };
}
