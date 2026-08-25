#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/data/flowcrm.db}"

echo "Applying database schema..."
npx prisma db push --accept-data-loss --skip-generate

echo "Ensuring default job types..."
node <<'EOF'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const defaults = [
  { code: "ELEKTRIK", label: "Elektrik", sortOrder: 0, active: true },
  { code: "SIHHI_TESISAT", label: "Sıhhi Tesisat", sortOrder: 1, active: true },
  { code: "KLIMA_HVAC", label: "Klima / HVAC", sortOrder: 2, active: true },
  { code: "BOYA_BADANA", label: "Boya & Badana", sortOrder: 3, active: true },
  { code: "AYDINLATMA", label: "Aydınlatma", sortOrder: 4, active: true },
  { code: "KAPI_PENCERE", label: "Kapı & Pencere", sortOrder: 5, active: true },
  { code: "GENEL_BAKIM", label: "Genel Bakım", sortOrder: 6, active: true },
  { code: "DIGER", label: "Diğer", sortOrder: 7, active: true },
];

(async () => {
  for (const item of defaults) {
    await prisma.jobTypeDefinition.upsert({
      where: { code: item.code },
      create: item,
      update: {},
    });
  }
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF

if [ "${SEED_ON_START}" = "true" ] && [ ! -f /data/.seeded ]; then
  echo "Seeding initial data..."
  npx prisma db seed
  touch /data/.seeded
fi

mkdir -p /app/uploads/hr-leaves /app/uploads/findings /app/uploads/work-orders

echo "Starting Norm Work On..."
exec node server.js
