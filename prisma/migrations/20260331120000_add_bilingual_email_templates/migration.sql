-- AlterTable
ALTER TABLE `EmailTemplate` ADD COLUMN `language` VARCHAR(191) NOT NULL DEFAULT 'en',
    ADD COLUMN `type` VARCHAR(191) NULL;
