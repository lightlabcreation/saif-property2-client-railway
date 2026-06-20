-- AlterTable
ALTER TABLE `unit` ADD COLUMN `ffe_installed_target_manual` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `final_cleaning_target_manual` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gc_cleaned_target_manual` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gc_deficiencies_target_manual` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gc_delivered_target_manual` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ose_installed_target_manual` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `unit_ready_target_manual` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `auditLogs` INTEGER;

-- CreateTable
CREATE TABLE `holiday` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `holiday_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auditlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NULL,
    `details` TEXT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auditlog` ADD CONSTRAINT `auditlog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
