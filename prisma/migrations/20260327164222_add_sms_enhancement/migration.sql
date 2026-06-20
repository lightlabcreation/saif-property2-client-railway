-- SAFE SMS ENHANCEMENT MIGRATION
-- This script only ADDS columns and tables. No data will be deleted.

-- 1. Add preferredLanguage to User
ALTER TABLE `user` ADD COLUMN `preferredLanguage` VARCHAR(191) DEFAULT 'English';

-- 2. Add tracking fields to Message
ALTER TABLE `message` ADD COLUMN `isReadByAdmin` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `message` ADD COLUMN `direction` VARCHAR(191) NOT NULL DEFAULT 'OUTBOUND';

-- 3. Create SMSTemplate Table
CREATE TABLE `smstemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `category` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Create SMSCampaign Table
CREATE TABLE `smscampaign` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `senderId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `totalRecipients` INTEGER NOT NULL DEFAULT 0,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `buildingId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
