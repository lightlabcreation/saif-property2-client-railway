-- CreateTable
CREATE TABLE `vehicle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL,
    `leaseId` INTEGER NULL,
    `make` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `licensePlate` VARCHAR(191) NOT NULL,
    `parkingSpace` VARCHAR(191) NULL,
    `photo1Url` VARCHAR(191) NULL,
    `photo2Url` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicle_licensePlate_key`(`licensePlate`),
    INDEX `vehicle_tenantId_fkey`(`tenantId`),
    INDEX `vehicle_leaseId_fkey`(`leaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `vehicle` ADD CONSTRAINT `vehicle_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle` ADD CONSTRAINT `vehicle_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
