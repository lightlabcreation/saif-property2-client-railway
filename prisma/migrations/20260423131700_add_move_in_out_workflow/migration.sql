-- AlterTable
ALTER TABLE `unit` ADD COLUMN `classification` VARCHAR(191) NULL DEFAULT 'Completed Unit';

-- CreateTable
CREATE TABLE `moveout` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leaseId` INTEGER NOT NULL,
    `unitId` INTEGER NOT NULL,
    `bedroomId` INTEGER NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'VISUAL_INSPECTION_SCHEDULED', 'FINAL_INSPECTION_SCHEDULED', 'INSPECTIONS_COMPLETED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `targetDate` DATETIME(3) NULL,
    `actualDate` DATETIME(3) NULL,
    `managerApproved` BOOLEAN NOT NULL DEFAULT false,
    `managerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `moveout_leaseId_key`(`leaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `movein` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leaseId` INTEGER NULL,
    `unitId` INTEGER NOT NULL,
    `bedroomId` INTEGER NULL,
    `status` ENUM('PENDING', 'BLOCKED_IN_CONSTRUCTION', 'BLOCKED_IN_PREPARATION', 'REQUIREMENTS_PENDING', 'READY_FOR_MOVE_IN', 'INSPECTION_COMPLETED', 'OCCUPIED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `targetDate` DATETIME(3) NULL,
    `actualDate` DATETIME(3) NULL,
    `overrideFlag` BOOLEAN NOT NULL DEFAULT false,
    `overrideReason` TEXT NULL,
    `overrideByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `movein_leaseId_key`(`leaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspectiontemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('MOVE_IN', 'MOVE_OUT') NOT NULL,
    `structure` JSON NULL,
    `isLocked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `unitId` INTEGER NOT NULL,
    `bedroomId` INTEGER NULL,
    `leaseId` INTEGER NULL,
    `inspectorId` INTEGER NOT NULL,
    `tenantSignature` TEXT NULL,
    `noDeficiencyConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('DRAFT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspectionitemresponse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `inspectionId` INTEGER NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `response` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspectionmedia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `responseId` INTEGER NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `annotations` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unitpreptask` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unitId` INTEGER NOT NULL,
    `bedroomId` INTEGER NULL,
    `ticketId` INTEGER NULL,
    `stage` ENUM('PENDING_TICKETS', 'READY_FOR_CLEANING', 'CLEANING_IN_PROGRESS', 'CLEANING_COMPLETED', 'UNIT_READY') NOT NULL DEFAULT 'PENDING_TICKETS',
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `title` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unithistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unitId` INTEGER NOT NULL,
    `bedroomId` INTEGER NULL,
    `userId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `oldStatus` VARCHAR(191) NULL,
    `newStatus` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `moveout` ADD CONSTRAINT `moveout_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `moveout` ADD CONSTRAINT `moveout_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `moveout` ADD CONSTRAINT `moveout_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `movein` ADD CONSTRAINT `movein_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `movein` ADD CONSTRAINT `movein_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `movein` ADD CONSTRAINT `movein_overrideByUserId_fkey` FOREIGN KEY (`overrideByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection` ADD CONSTRAINT `inspection_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `inspectiontemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `inspection` ADD CONSTRAINT `inspection_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `inspection` ADD CONSTRAINT `inspection_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `inspection` ADD CONSTRAINT `inspection_inspectorId_fkey` FOREIGN KEY (`inspectorId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspectionitemresponse` ADD CONSTRAINT `inspectionitemresponse_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspectionmedia` ADD CONSTRAINT `inspectionmedia_responseId_fkey` FOREIGN KEY (`responseId`) REFERENCES `inspectionitemresponse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unitpreptask` ADD CONSTRAINT `unitpreptask_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unithistory` ADD CONSTRAINT `unithistory_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `unithistory` ADD CONSTRAINT `unithistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
