-- CreateEnum
CREATE TYPE "bus_status" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "transport_shift" AS ENUM ('MORNING', 'EVENING', 'BOTH');

-- CreateEnum
CREATE TYPE "transport_trip_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "transport_trip_event_type" AS ENUM ('STARTED', 'ARRIVED_STOP');

-- AlterEnum
ALTER TYPE "payment_allocation_kind" ADD VALUE 'TRANSPORT';

-- AlterTable
ALTER TABLE "student_fee_structures" ADD COLUMN     "transport_fee" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "buses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plate_number" VARCHAR(30) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "driver_name" VARCHAR(160) NOT NULL,
    "driver_phone" VARCHAR(30) NOT NULL,
    "driver_license_number" VARCHAR(100) NOT NULL,
    "driver_emergency_contact" VARCHAR(160) NOT NULL,
    "status" "bus_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "shift" "transport_shift" NOT NULL DEFAULT 'BOTH',
    "bus_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "morning_eta" VARCHAR(5),
    "evening_eta" VARCHAR(5),

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "stop_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_trips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "trip_date" DATE NOT NULL,
    "status" "transport_trip_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "transport_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_trip_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "stop_id" UUID,
    "type" "transport_trip_event_type" NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buses_tenant_id_status_idx" ON "buses"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "buses_tenant_id_plate_number_key" ON "buses"("tenant_id", "plate_number");

-- CreateIndex
CREATE UNIQUE INDEX "buses_id_tenant_id_key" ON "buses"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "transport_routes_tenant_id_shift_idx" ON "transport_routes"("tenant_id", "shift");

-- CreateIndex
CREATE INDEX "transport_routes_tenant_id_bus_id_idx" ON "transport_routes"("tenant_id", "bus_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_routes_tenant_id_name_key" ON "transport_routes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transport_routes_id_tenant_id_key" ON "transport_routes"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "route_stops_tenant_id_route_id_idx" ON "route_stops"("tenant_id", "route_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_id_tenant_id_key" ON "route_stops"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_sequence_key" ON "route_stops"("route_id", "sequence");

-- CreateIndex
CREATE INDEX "transport_assignments_tenant_id_route_id_idx" ON "transport_assignments"("tenant_id", "route_id");

-- CreateIndex
CREATE INDEX "transport_assignments_tenant_id_stop_id_idx" ON "transport_assignments"("tenant_id", "stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_assignments_student_id_tenant_id_key" ON "transport_assignments"("student_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_assignments_id_tenant_id_key" ON "transport_assignments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "transport_trips_tenant_id_route_id_status_idx" ON "transport_trips"("tenant_id", "route_id", "status");

-- CreateIndex
CREATE INDEX "transport_trips_tenant_id_trip_date_idx" ON "transport_trips"("tenant_id", "trip_date");

-- CreateIndex
CREATE UNIQUE INDEX "transport_trips_id_tenant_id_key" ON "transport_trips"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "transport_trip_events_tenant_id_trip_id_idx" ON "transport_trip_events"("tenant_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_trip_events_id_tenant_id_key" ON "transport_trip_events"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "buses" ADD CONSTRAINT "buses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_bus_id_tenant_id_fkey" FOREIGN KEY ("bus_id", "tenant_id") REFERENCES "buses"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "transport_routes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "transport_routes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_stop_id_tenant_id_fkey" FOREIGN KEY ("stop_id", "tenant_id") REFERENCES "route_stops"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_route_id_tenant_id_fkey" FOREIGN KEY ("route_id", "tenant_id") REFERENCES "transport_routes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trip_events" ADD CONSTRAINT "transport_trip_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trip_events" ADD CONSTRAINT "transport_trip_events_trip_id_tenant_id_fkey" FOREIGN KEY ("trip_id", "tenant_id") REFERENCES "transport_trips"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trip_events" ADD CONSTRAINT "transport_trip_events_stop_id_tenant_id_fkey" FOREIGN KEY ("stop_id", "tenant_id") REFERENCES "route_stops"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;
