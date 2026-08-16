/**
 * Seed script — run with:
 *   pnpm --filter @workspace/db tsx src/seed.ts
 */
import { db, pool } from "./index";
import {
  tenantsTable,
  tenantUsersTable,
  departmentsTable,
  departmentAgentsTable,
} from "./schema";

async function seed() {
  console.log("🌱 Seeding database...");

  // Tenants
  const [tenant1, tenant2] = await db
    .insert(tenantsTable)
    .values([
      {
        name: "Empresa Demo",
        slug: "empresa-demo",
        planType: "professional",
        status: "active",
        maxAgents: 50,
      },
      {
        name: "Startup Beta",
        slug: "startup-beta",
        planType: "starter",
        status: "active",
        maxAgents: 10,
      },
    ])
    .onConflictDoNothing()
    .returning();

  if (!tenant1 || !tenant2) {
    console.log("⚠️  Tenants already exist, skipping seed.");
    await pool.end();
    return;
  }

  console.log(`✅ Created tenants: ${tenant1.name}, ${tenant2.name}`);

  // Departments for tenant1
  const [deptVendas, deptSuporte, deptFinanceiro] = await db
    .insert(departmentsTable)
    .values([
      {
        tenantId: tenant1.id,
        name: "Vendas",
        description: "Equipe comercial e pré-venda",
        color: "#25D366",
        status: "active",
      },
      {
        tenantId: tenant1.id,
        name: "Suporte",
        description: "Atendimento e pós-venda",
        color: "#128C7E",
        status: "active",
      },
      {
        tenantId: tenant1.id,
        name: "Financeiro",
        description: "Cobranças e faturamento",
        color: "#075E54",
        status: "active",
      },
    ])
    .returning();

  console.log(`✅ Created departments: Vendas, Suporte, Financeiro`);

  // Demo users for tenant1
  const [admin1] = await db
    .insert(tenantUsersTable)
    .values([
      {
        tenantId: tenant1.id,
        clerkUserId: "demo_admin_001",
        email: "admin@empresademo.com.br",
        firstName: "Carlos",
        lastName: "Administrador",
        role: "admin",
        status: "active",
        isSuperAdmin: false,
      },
      {
        tenantId: tenant1.id,
        clerkUserId: "demo_agent_001",
        email: "agente1@empresademo.com.br",
        firstName: "Ana",
        lastName: "Silva",
        role: "agent",
        status: "active",
        isSuperAdmin: false,
      },
      {
        tenantId: tenant1.id,
        clerkUserId: "demo_agent_002",
        email: "agente2@empresademo.com.br",
        firstName: "Roberto",
        lastName: "Mendes",
        role: "supervisor",
        status: "active",
        isSuperAdmin: false,
      },
    ])
    .returning();

  console.log(`✅ Created 3 users for ${tenant1.name}`);

  if (deptVendas && deptSuporte) {
    await db
      .insert(departmentAgentsTable)
      .values([
        {
          departmentId: deptVendas.id,
          tenantId: tenant1.id,
          clerkUserId: "demo_agent_001",
          isPrimary: true,
        },
        {
          departmentId: deptSuporte.id,
          tenantId: tenant1.id,
          clerkUserId: "demo_agent_002",
          isPrimary: true,
        },
      ])
      .onConflictDoNothing();

    console.log("✅ Assigned agents to departments");
  }

  console.log("🎉 Seed complete!");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
