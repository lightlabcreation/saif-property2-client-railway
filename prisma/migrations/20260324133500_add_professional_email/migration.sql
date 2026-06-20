-- CreateTable: EmailTemplate
CREATE TABLE `emailtemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: CommunicationLog
ALTER TABLE `communicationlog` 
    ADD COLUMN `subject` VARCHAR(191) NULL,
    ADD COLUMN `hasAttachments` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `templateId` INTEGER NULL,
    ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `openedAt` DATETIME(3) NULL;

-- AlterTable: Document
ALTER TABLE `document` 
    ADD COLUMN `propertyId` INTEGER NULL,
    ADD COLUMN `unitId` INTEGER NULL,
    ADD COLUMN `emailTemplateId` INTEGER NULL;

-- AlterTable: User (New relation)
ALTER TABLE `user` ADD COLUMN `buildingId` INTEGER NULL;
ALTER TABLE `user` ADD CONSTRAINT `user_buildingId_fkey` FOREIGN KEY (`buildingId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CommunicationLog -> EmailTemplate
ALTER TABLE `communicationlog` ADD CONSTRAINT `communicationlog_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `emailtemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Document -> EmailTemplate/Property/Unit
ALTER TABLE `document` ADD CONSTRAINT `document_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `document` ADD CONSTRAINT `document_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `document` ADD CONSTRAINT `document_emailTemplateId_fkey` FOREIGN KEY (`emailTemplateId`) REFERENCES `emailtemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
