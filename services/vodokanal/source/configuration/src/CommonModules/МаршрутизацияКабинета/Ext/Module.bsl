Функция МодульДействия(Действие) Экспорт
    Если Действие = "workspaceAuthority" Тогда Возврат "ПолитикаДоступа"; КонецЕсли;
    Если СтрРазделить("privateSummaryCreate,privateSummaryGet,privateSummaryLookup,privateSummaryPreview,privateSummaryCapsule", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисПриватныхСводок"; КонецЕсли;
    Если СтрРазделить("identityContact,identityMailbox,identityMailboxConfigure,identityContactRequest,identityContactConfirm,ownershipTransfers,ownershipCreate,ownershipAccept,ownershipDecline,ownershipRevoke,identityOwnAccounts", ",").Найти(Действие) <> Неопределено Тогда Возврат "СаморегистрацияКабинета"; КонецЕсли;
    Если СтрРазделить("meterPhotoUpload,meterPhoto,meterPhotoDownload,meterReview,meterAcceptedSeries,meterCorrectionRequests,meterReviewDecisions,waterDeliveryCreate,waterDeliveries,waterMyDeliveries,waterDeliveryAction,waterDeliveryOptions,waterSetupPage", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисАбонентовКабинета"; КонецЕсли;
    Если СтрРазделить("documentsList,documentsUpload,documentsGet,documentsReplace,documentsDownload,documentsSubmit,documentsArchive,documentsDelete,exportsCreate,exportsDownload", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисДокументов"; КонецЕсли;
    Если СтрРазделить("publicPortalEntries,publicPortalSave,publicPortalPublish,publicPortalArchive", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисПубличногоПортала"; КонецЕсли;
    Если СтрРазделить("notifications,notificationRead,notificationSettings,notificationSettingsChange,notificationDeliveries,notificationRetry", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисУведомлений"; КонецЕсли;
    Если СтрРазделить("operationsSettings,operationsSettingChange,operationsSettingHistory,operationsAudit,operationsJobs,operationsJobRetry", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисЭксплуатации"; КонецЕсли;
    Если СтрРазделить("workMaterialsRequestsPage,workMaterialsDocumentsPage", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисСклада"; КонецЕсли;
    Если СтрРазделить("p0DispatchPage,p0DispatchPublicIntakes,p0DispatchOwnHistory,p0DispatchStaffHistory,p0DispatchClaimReceipt,p0DispatchOwnGuestPhoto,p0DispatchStaffGuestPhoto,p0DispatchSaveOutage,p0DispatchPublishOutage,p0DispatchSaveNetwork,p0DispatchSaveNetworkLink,p0DispatchIncidentAsset,p0DispatchSubscription,p0WorkCrewProfile,p0WorkSaveCrewProfile", ",").Найти(Действие) <> Неопределено Тогда Возврат "СервисДиспетчерской"; КонецЕсли;
    Возврат "";
КонецФункции

Функция ЭтоЧтение(Действие) Экспорт
    Если Действие = "workspaceAuthority" Тогда Возврат Истина; КонецЕсли;
    Если СтрРазделить("privateSummaryGet,privateSummaryLookup,privateSummaryPreview,privateSummaryCapsule", ",").Найти(Действие) <> Неопределено Тогда Возврат Истина; КонецЕсли;
    Возврат СтрРазделить("identityContact,identityMailbox,meterPhoto,meterPhotoDownload,meterAcceptedSeries,meterCorrectionRequests,meterReviewDecisions,waterDeliveries,waterMyDeliveries,waterDeliveryOptions,waterSetupPage,documentsList,documentsGet,documentsDownload,exportsDownload,publicPortalEntries,notifications,notificationSettings,notificationDeliveries,operationsSettings,operationsSettingHistory,operationsAudit,operationsJobs,ownershipTransfers,identityOwnAccounts,workMaterialsRequestsPage,workMaterialsDocumentsPage,p0DispatchPage,p0DispatchPublicIntakes,p0DispatchOwnHistory,p0DispatchStaffHistory,p0DispatchOwnGuestPhoto,p0DispatchStaffGuestPhoto,p0WorkCrewProfile", ",").Найти(Действие) <> Неопределено;
КонецФункции

Функция ЭтоЭкспорт(Действие) Экспорт
    Возврат Действие = "exportsCreate";
КонецФункции

Функция ОбработатьЗапрос(Действие, УчетнаяЗапись, Запрос, Корреляция) Экспорт
    Если Действие = "workspaceAuthority" Тогда
        Для Каждого Параметр Из Запрос.ПараметрыЗапроса Цикл
            Если Параметр.Ключ <> "areaIds" Тогда ВызватьИсключение "кабинет_некорректно_фильтр"; КонецЕсли;
        КонецЦикла;
        ОбластиТекст = APIКабинета.ТекстПараметраЗапроса(Запрос, "areaIds", 3699);
        Области = Новый Массив;
        Если ОбластиТекст <> "" Тогда Области = СтрРазделить(ОбластиТекст, ",", Истина); КонецЕсли;
        Если Области.Количество() > 100 Тогда ВызватьИсключение "кабинет_некорректно_фильтр"; КонецЕсли;
        Данные = ПолитикаДоступа.ПолучитьКонтекстПолномочий(УчетнаяЗапись, Запрос.ПараметрыURL.Получить("id"), Области);
        Возврат APIКабинета.СформироватьОтветHTTP(200, Данные, Корреляция);
    КонецЕсли;
    Модуль = МодульДействия(Действие);
    Если Модуль = "СаморегистрацияКабинета" Тогда Возврат СаморегистрацияКабинета.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисПриватныхСводок" Тогда Возврат СервисПриватныхСводок.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисАбонентовКабинета" Тогда Возврат СервисАбонентовКабинета.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисДокументов" Тогда Возврат СервисДокументов.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисПубличногоПортала" Тогда Возврат СервисПубличногоПортала.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисУведомлений" Тогда Возврат СервисУведомлений.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисЭксплуатации" Тогда Возврат СервисЭксплуатации.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисСклада" Тогда Возврат СервисСклада.ОбработатьСтраницуМатериаловHTTP(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    Если Модуль = "СервисДиспетчерской" Тогда Возврат СервисДиспетчерской.ОбработатьЗапросКабинета(Действие, УчетнаяЗапись, Запрос, Корреляция); КонецЕсли;
    ВызватьИсключение "кабинет_неизвестно_действие";
КонецФункции
