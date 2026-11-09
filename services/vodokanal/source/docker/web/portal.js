(() => {
  "use strict";

  const API = "/vodokanal/hs/api/v1/";
  const roles = new Map([
    ["Dispatcher", "Диспетчер"],
    ["LabTechnician", "Лаборант"],
    ["LabApprover", "Утверждающий лаборатории"],
    ["WaterOperator", "Оператор водоснабжения"],
    ["Storekeeper", "Кладовщик"],
    ["BillingSpecialist", "Специалист по расчетам"],
    ["ConnectionEngineer", "Инженер подключений"],
    ["SupportOperator", "Оператор поддержки"],
    ["CrewLeader", "Руководитель бригады"],
    ["CrewMember", "Участник бригады"],
    ["Resident", "Житель"]
  ]);
  const registrySchemas = new Map([
    ["subscribers", { title: "Абоненты", single: "Абонент", search: "Точное наименование абонента", dependencies: [], fields: [
      { name: "partyType", label: "Тип абонента", kind: "choice", choices: [["Person", "Физическое лицо"], ["Organization", "Организация"], ["Entrepreneur", "Предприниматель"]] },
      { name: "phone", label: "Телефон", max: 32, optional: true, ascii: true },
      { name: "email", label: "Электронная почта", max: 128, optional: true, ascii: true }
    ] }],
    ["properties", { title: "Объекты", single: "Объект", search: "Точное наименование или адрес", dependencies: ["subscribers"], fields: [
      { name: "ownerSubscriberId", label: "Абонент-владелец", kind: "ref", resource: "subscribers" },
      { name: "address", label: "Адрес", max: 250 },
      { name: "propertyType", label: "Тип объекта", kind: "choice", choices: [["Residential", "Жилой"], ["Commercial", "Коммерческий"], ["Industrial", "Промышленный"], ["Other", "Другой"]] }
    ] }],
    ["service-points", { title: "Точки обслуживания", single: "Точка обслуживания", search: "Точное наименование точки", dependencies: ["subscribers", "properties"], fields: [
      { name: "propertyId", label: "Объект", kind: "ref", resource: "properties" },
      { name: "serviceKind", label: "Услуга", kind: "choice", choices: [["WaterSupply", "Водоснабжение"], ["Wastewater", "Водоотведение"]] }
    ] }],
    ["contracts", { title: "Договоры", single: "Договор", search: "Точный номер договора", dependencies: ["subscribers", "properties", "service-points"], fields: [
      { name: "subscriberId", label: "Абонент", kind: "ref", resource: "subscribers" },
      { name: "serviceKind", label: "Услуга", kind: "choice", choices: [["WaterSupply", "Водоснабжение"], ["Wastewater", "Водоотведение"]] },
      { name: "propertyId", label: "Объект этого абонента", kind: "ref", resource: "properties" },
      { name: "servicePointId", label: "Точка выбранного объекта и услуги", kind: "ref", resource: "service-points" },
      { name: "number", label: "Номер договора", max: 64, kind: "numberCode" },
      { name: "validFrom", label: "Начало действия (время браузера)", kind: "date" },
      { name: "validTo", label: "Окончание (необязательно, время браузера)", kind: "date", optional: true }
    ] }],
    ["personal-accounts", { title: "Лицевые счета", single: "Лицевой счет", search: "Точный номер лицевого счета", dependencies: ["subscribers", "properties", "service-points", "contracts"], fields: [
      { name: "contractId", label: "Договор", kind: "ref", resource: "contracts" },
      { name: "propertyId", label: "Объект по договору", kind: "ref", resource: "properties", locked: true },
      { name: "servicePointId", label: "Точка по договору", kind: "ref", resource: "service-points", locked: true },
      { name: "number", label: "Номер лицевого счета (уникален в пространстве)", max: 32, kind: "numberCode" }
    ] }]
  ]);
  const errors = {
    кабинет_учетная_запись_требуется: "Для пользователя 1С еще не настроена учетная запись портала. Обратитесь к администратору.",
    кабинет_учетная_запись_отключено: "Учетная запись портала отключена.",
    кабинет_аутентификация_требуется: "Необходимо войти в учетную запись 1С.",
    кабинет_сеанс_отсутствует: "Сессия не найдена. Войдите заново.",
    кабинет_сеанс_отозвано: "Сессия завершена. Войдите заново.",
    кабинет_сеанс_истекло: "Срок сессии истек. Войдите заново.",
    кабинет_сеанс_участник_несовпадение: "Пользователь сессии изменился. Войдите заново.",
    кабинет_сеанс_не_найдено: "Сеанс не найден среди ваших сеансов. Обновите список.",
    кабинет_новый_вход_требуется: "Не удалось начать новую сессию. Обновите страницу и повторите вход.",
    кабинет_пространство_неактивно: "Пространство неактивно. Обновите список пространств.",
    кабинет_пространство_запрещено: "Недостаточно прав в выбранном пространстве.",
    кабинет_пространство_не_найдено: "Пространство не найдено. Обновите данные.",
    кабинет_некорректно_пространство_имя: "Введите название пространства длиной не более 150 символов.",
    кабинет_редакция_конфликт: "Назначение роли уже изменилось. Обновите данные и повторите действие.",
    кабинет_пространство_конфликт: "Обнаружен конфликт личных пространств. Обратитесь к администратору.",
    кабинет_некорректно_роль: "Эта роль недоступна для локального назначения.",
    кабинет_источник_запрещено: "Этот адрес портала не разрешен для изменения данных. Используйте настроенный локальный адрес.",
    кабинет_запрос_заголовок_требуется: "Сервер отклонил запрос приложения.",
    кабинет_идентификация_привязка_конфликт: "Обнаружен конфликт привязки пользователя 1С. Обратитесь к администратору.",
    кабинет_участие_привязка_конфликт: "Обнаружен конфликт назначения роли. Обратитесь к администратору.",
    кабинет_цель_не_участник: "Новый участник должен сначала принять приглашение в пространство.",
    кабинет_цель_учетная_запись_не_найдено: "Учетная запись получателя не найдена или неактивна. Проверьте ID.",
    кабинет_некорректно_область_имя: "Введите название области длиной не более 150 символов.",
    кабинет_область_не_найдено: "Область не найдена или недоступна. Обновите данные.",
    кабинет_область_запрещено: "Нет доступа к этой области.",
    кабинет_область_квота_превышено: "В пространстве достигнут лимит в 100 областей.",
    кабинет_область_запрос_конфликт: "Этот запрос создания области уже использован с другими данными.",
    кабинет_приглашение_не_найдено: "Приглашение не найдено или недоступно этой учетной записи.",
    кабинет_приглашение_истекло: "Срок приглашения истек. Запросите новое приглашение.",
    кабинет_приглашение_состояние_конфликт: "Приглашение уже обработано. Обновите данные.",
    кабинет_приглашение_запрос_конфликт: "Этот запрос приглашения уже использован с другими данными.",
    кабинет_участие_активно_конфликт: "Такая роль уже действует. Приглашение не заменяет действующее назначение.",
    кабинет_участие_состояние_конфликт: "Состояние назначения уже изменилось. Обновите данные.",
    кабинет_некорректно_пароль: "Новый пароль должен содержать от 12 до 128 символов без управляющих символов.",
    кабинет_повторная_авторизация_требуется: "Требуется свежее подтверждение паролем. Повторите вход.",
    кабинет_пароль_изменение_не_удалось: "Сервер не подтвердил смену пароля. Войдите заново и проверьте результат.",
    кабинет_шифрование_недоступно: "Не удалось подготовить отправку. Откройте защищённую версию сайта или обратитесь в поддержку.",
    кабинет_реестр_некорректно_поле: "Проверьте поля записи: обязательные значения, длину и допустимые символы.",
    кабинет_реестр_некорректно_номер: "В номере допустимы латинские буквы, цифры и - / _. Начальные нули сохраняются.",
    кабинет_реестр_некорректно_даты: "Проверьте даты: окончание должно быть позднее начала.",
    кабинет_реестр_не_найдено: "Запись реестра не найдена или недоступна в выбранной области.",
    кабинет_реестр_связь_конфликт: "Связи абонента, объекта, точки и договора не согласованы. Обновите связанные записи.",
    кабинет_личный_учетная_запись_номер_конфликт: "Номер лицевого счета уже занят в этом пространстве, включая архивные записи.",
    кабинет_реестр_экспорт_лимит: "Для CSV выберите меньше 100 записей. Уточните фильтры и загрузите список заново.",
    кабинет_жизненный_цикл_некорректно_ресурс: "Для этого раздела изменение и история пока недоступны.",
    кабинет_жизненный_цикл_некорректно_тело: "Сервер отклонил состав полей изменения. Обновите карточку.",
    кабинет_жизненный_цикл_некорректно_поле: "Заполните обязательные поля. Основание — до 250 символов. Телефон и email укажите латинскими буквами, цифрами и обычными знаками.",
    кабинет_жизненный_цикл_не_найдено: "Карточка не найдена или недоступна в выбранной области. Обновите список.",
    кабинет_жизненный_цикл_редакция_конфликт: "Карточка изменилась. Откройте её заново из списка и проверьте данные.",
    кабинет_жизненный_цикл_состояние_конфликт: "Запись уже в архиве или ее состояние не допускает действие. Обновите карточку.",
    кабинет_жизненный_цикл_запрос_конфликт: "Этот запрос уже использован для другого изменения. Обновите карточку и проверьте результат.",
    кабинет_жизненный_цикл_привязка_конфликт: "Обнаружен конфликт истории изменения. Автоматического исправления нет.",
    кабинет_жизненный_цикл_активно_личный_учетные_записи: "Договор нельзя прекратить, пока на него ссылается хотя бы один действующий лицевой счет. Сначала закройте все такие ЛС; текущий договор не изменен.",
    кабинет_абонент_учетная_запись_не_найдено: "Лицевой счет не найден или нет подтвержденного персонального доступа.",
    кабинет_абонент_запрос_не_найдено: "Заявка не найдена среди доступных этой учетной записи.",
    кабинет_абонент_связь_не_найдено: "Персональная связь не найдена или недоступна.",
    кабинет_абонент_запрос_состояние_конфликт: "Заявка уже обработана. Обновите список.",
    кабинет_абонент_связь_состояние_конфликт: "Состояние персональной связи уже изменилось. Обновите данные.",
    кабинет_абонент_некорректно_причина: "Укажите основание длиной до 250 символов без управляющих символов.",
    кабинет_абонент_ожидание_квота_превышено: "Достигнут лимит в 10 ожидающих заявок. Отмените лишние или дождитесь решения.",
    кабинет_счетчик_некорректно_поле: "Проверьте обязательные поля паспорта или установки и их длину.",
    кабинет_счетчик_некорректно_значение: "Значение должно быть неотрицательным числом до трех знаков после точки и помещаться в разряды прибора. Округления нет.",
    кабинет_счетчик_некорректно_даты: "Проверьте даты установки, допуска и измерения. Сервер допускает время не позднее чем на 5 минут вперед.",
    кабинет_счетчик_не_найдено: "Установка или показание не найдены либо недоступны для выбранного ЛС.",
    кабинет_счетчик_серийный_конфликт: "Такой производитель, модель и серийный номер уже существуют в этом пространстве.",
    кабинет_счетчик_установка_конфликт: "У паспорта уже есть связанная установка. Замена прибора пока не реализована.",
    кабинет_счетчик_связь_конфликт: "Паспорт, лицевой счет и точка обслуживания не согласованы в одной области.",
    кабинет_счетчик_запрос_конфликт: "Этот запрос уже использован для другой операции. Проверьте результат перед новой отправкой.",
    кабинет_счетчик_временная_метка_конфликт: "На это время уже есть другое показание или начальная база. Выберите фактическое время измерения.",
    кабинет_счетчик_показание_уменьшено: "Позднее показание меньше принятого предыдущего. Прием с уменьшением запрещен; исходная история не изменена.",
    кабинет_счетчик_неактивно: "Установка или паспорт неактивны. Доступно только чтение истории.",
    кабинет_счетчик_поверка_истекло: "Срок поверки истек или недостаточен для допуска. Новые установки и показания отклонены.",
    кабинет_счетчик_привязка_конфликт: "Обнаружен конфликт связей прибора. Требуется проверка оператором; автоматического исправления нет.",
    кабинет_вода_некорректно_тело: "Сервер отклонил состав полей водоснабжения. Обновите данные.",
    кабинет_вода_некорректно_поле: "Проверьте обязательные поля: название до 150, основание или причина до 2000 символов без управляющих символов.",
    кабинет_вода_некорректно_количество: "Количество должно быть положительным числом не более 1000 м³, до трех знаков после точки. Округления нет.",
    кабинет_вода_некорректно_даты: "Проверьте даты. Фактическое время — не позднее чем на 5 минут вперед, плановое — не более чем на 90 дней вперед.",
    кабинет_вода_некорректно_редакция: "Не удалось загрузить версию заказа. Откройте карточку заново.",
    кабинет_вода_некорректно_операция: "Это действие недоступно в текущем состоянии заказа.",
    кабинет_вода_не_найдено: "Заказ или запись водоснабжения не найдены либо недоступны в выбранной области.",
    кабинет_вода_запрос_конфликт: "Этот запрос уже использован для другой операции. Проверьте результат в карточке заказа.",
    кабинет_вода_начальные_данные_конфликт: "Начальное заполнение 10 м³ уже использовано. Для нового поступления заполните форму пополнения.",
    кабинет_вода_пополнение_квота: "Достигнут общий лимит поступлений — 1000 м³ на пространство. Выдачи и возвраты не восстанавливают этот лимит.",
    кабинет_вода_редакция_конфликт: "Заказ изменился. Откройте карточку заново и проверьте данные.",
    кабинет_вода_заказ_состояние_конфликт: "Состояние заказа уже не допускает действие. Откройте карточку заново.",
    кабинет_вода_недостаточно_доступно: "Недостаточно доступной воды для резерва. Заказ не подтвержден; обновите остатки и карточку.",
    кабинет_вода_возврат_превышает_выдано: "Возврат превышает выданное количество за вычетом предыдущих возвратов. Обновите карточку.",
    кабинет_вода_связь_конфликт: "Источник, точка, получатель и заказ не согласованы в выбранной области.",
    кабинет_вода_привязка_конфликт: "Обнаружен конфликт привязки водоснабжения. Требуется проверка оператором; автоматического исправления нет.",
    кабинет_вода_некорректно_движение: "Движение отклонено проверкой целостности. Требуется проверка оператором.",
    кабинет_вода_движение_нельзя_изменять: "Проведенное движение неизменяемо. Перепроведение, отмена проведения и удаление недоступны.",
    кабинет_диспетчерская_некорректно_тело: "Состав полей заявки отклонен. Служебные поля и неподдерживаемые вложения отправлять нельзя.",
    кабинет_диспетчерская_некорректно_поле: "Проверьте поля формы. Телефон и email укажите латинскими буквами, цифрами и обычными знаками.",
    кабинет_диспетчерская_некорректно_даты: "Проверьте даты и порядок времени: начало не более 5 минут вперед; прогноз до 90 дней, срок заявки до 30 дней.",
    кабинет_диспетчерская_некорректно_действие: "Это действие недоступно. Откройте актуальную карточку.",
    кабинет_диспетчерская_некорректно_состояние: "Выберите допустимое состояние заявки.",
    кабинет_диспетчерская_не_найдено: "Заявка, приемная или инцидент не найдены либо недоступны этой учетной записи.",
    кабинет_диспетчерская_редакция_конфликт: "Карточка уже изменилась. Откройте ее заново; автоматического повтора нет.",
    кабинет_диспетчерская_запрос_конфликт: "Этот запрос уже использован для другой операции. Обновите карточку и проверьте результат.",
    кабинет_диспетчерская_состояние_конфликт: "Текущее состояние не допускает действие. Откройте карточку заново.",
    кабинет_диспетчерская_связь_конфликт: "Связь заявки и инцидента уже изменилась. Откройте обе карточки заново.",
    кабинет_диспетчерская_маршрутизация_конфликт: "Маршрут приемной изменился. Загрузите приемные перед новой заявкой.",
    кабинет_диспетчерская_прием_закрыто: "Приемная закрыта для новых обращений. Старые заявки остаются доступны заявителю.",
    кабинет_диспетчерская_необслуживаемо_адрес_или_категория: "Приемная не обслуживает этот точный адрес или категорию. Другой маршрут не выбирается автоматически.",
    кабинет_диспетчерская_активно_связано_запросы: "Инцидент нельзя закрыть: есть незавершенные связанные заявки. Их состояние не изменено.",
    кабинет_диспетчерская_квота_превышено: "Достигнут лимит записей. Обратитесь к оператору; закрытие записей не освобождает лимит.",
    кабинет_диспетчерская_привязка_конфликт: "Обнаружен конфликт неизменяемой истории. Требуется проверка; автоматического исправления нет.",
    кабинет_диспетчерская_вложенная_транзакция: "Сервер отклонил неподдерживаемую вложенную транзакцию."
  };
  const $ = (id) => document.getElementById(id);
  const ui = {
    login: $("login-screen"), app: $("application"), loginForm: $("login-form"),
    username: $("login-name"), password: $("login-password"), loginStatus: $("login-status"),
    loginButton: $("login-button"), logoutButton: $("logout-button"), refreshButton: $("refresh-button"),
    workspaceSelect: $("workspace-select"), workspaceForm: $("workspace-form"), workspaceName: $("workspace-name"),
    createButton: $("create-workspace-button"), roleForm: $("role-form"), roleSelect: $("role-select"),
    assignButton: $("assign-role-button"), membershipsBody: $("memberships-body"),
    roleTarget: $("role-target"), roleScope: $("role-scope"), roleArea: $("role-area"),
    areaForm: $("area-form"), areaName: $("area-name"), createAreaButton: $("create-area-button"),
    invitationForm: $("invitation-form"), invitationRecipient: $("invitation-recipient"),
    invitationRole: $("invitation-role"), invitationScope: $("invitation-scope"),
    invitationArea: $("invitation-area"), invitationTTL: $("invitation-ttl"),
    createInvitationButton: $("create-invitation-button"), passwordForm: $("password-form"),
    currentPassword: $("password-current"), newPassword: $("password-new"), confirmPassword: $("password-confirm"),
    passwordButton: $("change-password-button"), sessionsBody: $("sessions-body"),
    refreshSessionsButton: $("refresh-sessions-button"), revokeAllSessionsButton: $("revoke-all-sessions-button"),
    registryArea: $("registry-area"), registryEntity: $("registry-entity"), registryFilterState: $("registry-state"),
    registrySearch: $("registry-search"), registryFilterForm: $("registry-filter-form"), registryLoadButton: $("registry-load-button"), registryExportButton: $("registry-export-button"),
    registryList: $("registry-list"), registryDetail: $("registry-detail-body"), registryFields: $("registry-create-fields"),
    registryCreateForm: $("registry-create-form"), registryCreateButton: $("registry-create-button"),
    lifecycleForm: $("registry-lifecycle-form"), lifecycleFields: $("registry-lifecycle-fields"), lifecycleReason: $("registry-lifecycle-reason"), lifecycleButton: $("registry-lifecycle-button"),
    registryHistoryButton: $("registry-history-button"), registryHistory: $("registry-history-body"),
    customerRefreshButton: $("customer-refresh-button"), customerRequestForm: $("customer-request-form"),
    customerAccountId: $("customer-account-id"), customerRequestButton: $("customer-request-button"),
    customerRequests: $("customer-requests-list"), customerAccounts: $("customer-accounts-list"), customerDetail: $("customer-detail-body"),
    customerStaffArea: $("customer-staff-area"), customerQueueForm: $("customer-queue-form"), customerQueueButton: $("customer-queue-button"),
    customerPending: $("customer-pending-list"), customerStaffRevokeForm: $("customer-staff-revoke-form"),
    customerStaffLinkId: $("customer-staff-link-id"), customerStaffLinkRevision: $("customer-staff-link-revision"),
    customerStaffReason: $("customer-staff-reason"), customerStaffRevokeButton: $("customer-staff-revoke-button")
  };
  const m = {
    mode: $("meter-mode"), context: $("meter-context"), status: $("meter-view-status"), support: $("meter-support-detail"),
    readingError: $("meter-reading-error"), readingResult: $("meter-reading-result"), retry: $("meter-reading-retry-button"),
    refreshReading: $("meter-reading-refresh-button"), nextReading: $("meter-reading-next-button"),
    staffArea: $("meter-staff-area"), staffLoadForm: $("meter-staff-load-form"), staffLoadButton: $("meter-staff-load-button"),
    passportsList: $("meter-passports-list"), passportForm: $("meter-passport-form"), passportName: $("meter-passport-name"),
    passportType: $("meter-passport-type"), manufacturer: $("meter-manufacturer"), model: $("meter-model"), serial: $("meter-serial"),
    digits: $("meter-digits"), coefficient: $("meter-coefficient"), verification: $("meter-verification-until"), passportCreateButton: $("meter-passport-create-button"),
    installForm: $("meter-install-form"), installPassport: $("meter-install-passport"), installAccount: $("meter-install-account"),
    installPoint: $("meter-install-point"), installedAt: $("meter-installed-at"), admittedAt: $("meter-admitted-at"), initialValue: $("meter-initial-value"), installCreateButton: $("meter-install-create-button"),
    accountSelect: $("meter-account-select"), refreshAccountsButton: $("meter-refresh-accounts-button"), loadInstallationsButton: $("meter-load-installations-button"),
    installationSelect: $("meter-installation-select"), openInstallationButton: $("meter-open-installation-button"), installationDetail: $("meter-installation-detail"),
    chart: $("meter-chart"), historyBody: $("meter-history-body"), readingForm: $("meter-reading-form"), measuredAt: $("meter-measured-at"), measuredTime: $("meter-measured-time"), readingValue: $("meter-reading-value"), readingSubmitButton: $("meter-reading-submit-button"),
    correctionForm: $("meter-correction-form"), correctionReading: $("meter-correction-reading"), proposedAt: $("meter-proposed-at"), proposedValue: $("meter-proposed-value"),
    correctionReason: $("meter-correction-reason"), correctionSubmitButton: $("meter-correction-submit-button")
  };
  const w = {
    area: $("water-area"), loadForm: $("water-load-form"), loadButton: $("water-load-button"),
    setupKind: $("water-setup-kind"), setupName: $("water-setup-name"), setupForm: $("water-setup-form"), setupButton: $("water-setup-button"), setupList: $("water-setup-list"),
    point: $("water-point"), pointLoadButton: $("water-point-load-button"), balances: $("water-balances"), movements: $("water-movements"),
    receiptForm: $("water-receipt-form"), source: $("water-source"), receiptPoint: $("water-receipt-point"), occurredAt: $("water-occurred-at"), basis: $("water-basis"), quantity: $("water-quantity"), receiptButton: $("water-receipt-button"), seedButton: $("water-seed-button"),
    orderForm: $("water-order-form"), orderPoint: $("water-order-point"), recipient: $("water-recipient"), orderQuantity: $("water-order-quantity"), scheduledAt: $("water-scheduled-at"), orderCreateButton: $("water-order-create-button"),
    ordersList: $("water-orders-list"), orderDetail: $("water-order-detail"), actionForm: $("water-order-action-form"), action: $("water-order-action"), returnQuantity: $("water-return-quantity"), returnReason: $("water-return-reason"), actionButton: $("water-order-action-button")
  };
  const emptyState = () => ({ me: null, workspaces: [], memberships: [], authority: null, workspace: null, areas: [], incoming: [], outgoing: [], sessions: [], sessionsLoaded: false, workspaceId: "" });
  const dispatchIds = "own-load-button,intake,address,category,title,description,contact,request-form,request-button,own-list,own-detail,own-messages,own-reply-form,own-reply-text,own-reply-button,own-reopen-form,own-reopen-reason,own-reopen-button,own-history-button,own-history,intake-load-button,intake-list,intake-form,intake-select,intake-area,intake-name,intake-addresses,intake-categories,intake-published,intake-accepting,intake-button,area,load-form,state,load-button,queue,staff-detail,staff-messages,action-form,action,reason,action-button,staff-reply-form,staff-reply-visibility,staff-reply-text,staff-reply-button,triage-form,priority,due-at,triage-reason,triage-button,staff-history-button,staff-history,incident-form,incident-title,incident-type,incident-severity,incident-started-at,incident-forecast-at,incident-description,incident-create-button,incidents-list,incident-detail,incident-links,incident-action-form,incident-action,incident-update-severity,incident-update-forecast-at,incident-update-description,incident-reason,incident-action-button,relation-form,relation-action,relation-reason,relation-button".split(",");
  const d = Object.fromEntries(dispatchIds.map((name) => [name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), $("dispatch-" + name)]));
  const filePanels = Object.fromEntries(["own", "staff"].map((kind) => [kind, Object.fromEntries([
    ["panel", "files"], ["note", "files-note"], ["load", "files-load-button"], ["list", "files-list"], ["detail", "files-detail"],
    ["form", "file-form"], ["input", "file-input"], ["visibility", "file-visibility"], ["reason", "file-reason"],
    ["upload", "file-upload-button"], ["replace", "file-replace-button"], ["cancel", "file-cancel-button"]
  ].map(([name, id]) => [name, $("dispatch-" + kind + "-" + id)]))]));
  const fileTypes = new Map([["pdf", "application/pdf"], ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["txt", "text/plain"], ["csv", "text/csv"]]);
  const fileMetadataFields = "id,parentRequestId,visibility,authorLabel,revisionId,version,previousRevisionId,filename,mime,byteCount,sha256,createdAt,reason".split(",");
  const emptyRequestFiles = () => ({ parentId: "", loaded: false, rows: [], detail: null, stale: false, receipt: null, unresolved: null, buttons: [], detailButtons: [] });
  const requestFiles = { own: emptyRequestFiles(), staff: emptyRequestFiles() };
  let fileTask = null;
  const dispatchStates = ["Submitted", "Accepted", "AwaitingInfo", "Rejected", "Resolved"];
  const dispatchCategories = ["Leak", "NoWater", "Pressure", "Sewer", "Manhole", "Quality", "Billing", "Other"];
  const dispatchPriorities = ["Low", "Normal", "High", "Critical"];
  const dispatchSeverities = ["Minor", "Moderate", "Major", "Critical"];
  const dispatchPublicFields = "id,publicIntakeId,intakeName,address,category,title,description,contact,state,stage,acceptedAt,resolvedAt,lastPublicReason,createdAt,updatedAt,revision".split(",");
  const dispatchStaffFields = [...dispatchPublicFields, ..."workspaceId,areaId,requesterAccountId,responsibleAccountId,incidentId,priority,dueAt,overdue,messageCount,resumeState,createdBy".split(",")];
  const emptyDispatch = () => ({ ownLoaded: false, publicIntakes: [], ownRows: [], own: null, ownStale: false, ownedLoaded: false, owned: [], intakeEditing: null, intakeStale: false,
    loaded: false, scope: "", queue: [], staff: null, staffStale: false, incidents: [], incident: null, incidentStale: false });
  let dispatch = emptyDispatch();
  let dispatchButtons = [];
  let state = emptyState();
  let actionButtons = [];
  let sessionButtons = [];
  const emptyRegistry = () => ({ workspaceId: "", areaId: "", kind: "subscribers", rows: [], references: {}, detail: null, loaded: false, uncertain: false, lifecycleStale: false, filters: { state: "", search: "" } });
  let registry = emptyRegistry();
  let registryInputs = new Map();
  let registryButtons = [];
  let lifecycleInputs = new Map();
  let propertyServiceHistory = null;
  const emptyCustomer = () => ({ requests: [], accounts: [], detail: null, loaded: false, pending: [], pendingScope: "", pendingLoaded: false });
  let customer = emptyCustomer();
  let customerButtons = [];
  let customerPendingButtons = [];
  let customerReasons = new Map();
  const emptyMeterStaff = () => ({ scope: "", loaded: false, passports: [], accounts: [] });
  const emptyMeterView = () => ({ accountId: "", authority: "", installations: [], installation: null, readings: [], stale: false });
  let meterStaff = emptyMeterStaff();
  let meterView = emptyMeterView();
  let meterEpoch = 0;
  const emptyMeterReading = () => ({ phase: "idle", intent: null, result: null, refreshFailed: false });
  let meterReading = emptyMeterReading();
  const emptyWater = () => ({ scope: "", loaded: false, setup: { sources: [], points: [], recipients: [] }, orders: [], detail: null, stale: false, pointId: "", balances: null, movements: [] });
  let water = emptyWater();
  let waterButtons = [];
  let pendingCreations = { area: null, invitation: null, customerLink: null };
  let busy = false;
  let dashboardLoads = 0;
  let sequence = 0;
  let lab = null;
  let labStaff = null;
  let inventory = null;
  let inventoryLeaseTimer = null;
  let inventoryAccessRejected = false;
  let workMaterials = null;
  let workMaterialsLeaseTimer = null;
  let workMaterialsAccessRejected = false;
  let workOrders = null;
  let hydrology = null;
  let identityAccount = null, documents = null, subscriberWater = null, dispatchModule = null, operations = null, publicEditor = null;
  let hostEpoch = 0;
  let authorityTimer = null;
  let entryRouteApplied = false;
  let contextRendered = false;
  const hostRequests = new Set(), listPages = new Map();
  const pendingListPages = new WeakMap();
  let workOrdersLeaseTimer = null;
  let hydrologyLeaseTimer = null;
  let workOrdersAccessRejected = false;
  let hydrologyAccessRejected = false;
  let packagePermissionEpoch = 0;
  const moduleLocks = { inventory: false, materials: false, orders: false, hydrology: false, dispatch: false, documents: false, identity: false, subscriber: false, operations: false, public: false };
  let hostCreateIntent = null, hostCreateNotice = "";

  function hostCreationContext(intent) {
    return state.me?.accountId === intent.accountId && state.me?.actorId === intent.actorId && hostEpoch === intent.epoch &&
      state.workspaceId === intent.workspaceId && (intent.path === "workspaces" || registryContextReady() && registry.kind === intent.path && registry.areaId === intent.areaId);
  }

  function updateHostCreationControls() {
    const pending = Boolean(hostCreateIntent);
    if (pending) {
      for (const node of document.querySelectorAll("#registry-filter-form input,#registry-filter-form select,#registry-filter-form button,#registry-create-form input,#registry-create-form select,#registry-create-form button")) node.disabled = true;
      ui.workspaceName.disabled = true; ui.createButton.disabled = true;
    }
    $("host-create-retry").disabled = busy || !pending || !hostCreationContext(hostCreateIntent);
    $("host-create-abandon").disabled = busy || !pending;
  }

  function renderHostCreation() {
    $("host-create-receipt").hidden = !hostCreateIntent && !hostCreateNotice;
    $("host-create-receipt-text").textContent = hostCreateIntent
      ? "Результат создания неизвестен. Повторите ту же операцию кнопкой ниже. Не создавайте запись заново в другой форме."
      : hostCreateNotice;
    $("host-create-retry").hidden = !hostCreateIntent;
    $("host-create-abandon").hidden = !hostCreateIntent;
    publishModuleLock("host-create", Boolean(hostCreateIntent)); updateHostCreationControls();
  }

  function clearHostCreation() {
    if (hostCreateIntent) hostCreateNotice = "Рабочая область изменена. Данные для повтора удалены. Проверьте результат прежней отправки перед созданием новой записи.";
    hostCreateIntent = null; renderHostCreation();
  }

  function prepareHostCreation(path, body, onConfirmed) {
    if (hostCreateIntent) throw new ApiError(409, "ожидание_другое_операция", "");
    if (!state.me || !crypto?.randomUUID) throw new ApiError(0, "кабинет_шифрование_недоступно", "");
    return Object.freeze({ path, json: JSON.stringify(body), key: crypto.randomUUID(), accountId: state.me.accountId,
      actorId: state.me.actorId, epoch: hostEpoch, workspaceId: state.workspaceId, areaId: path === "workspaces" ? "" : registry.areaId, onConfirmed });
  }

  async function sendHostCreation(intent) {
    if (busy || !hostCreationContext(intent) || hostCreateIntent && hostCreateIntent !== intent) return;
    const retrying = hostCreateIntent === intent; hostCreateIntent = intent; hostCreateNotice = "";
    clearNotice(); setBusy(true); renderHostCreation(); let confirmed = false;
    try {
      const result = await request(intent.path, { method: "POST", body: JSON.parse(intent.json), headers: { "Idempotency-Key": intent.key }, moduleOwner: "host-create" });
      if (!hostCreationContext(intent)) throw new ApiError(0, "контекст_изменено", "");
      if (!result || !validPublicId(result.id)) throw new ApiError(0, "некорректно_ответ", "");
      if (intent.path !== "workspaces") {
        checkedRegistryRows([result], intent.workspaceId, intent.areaId);
        if (result.revision !== 1 || result.createdBy !== intent.accountId) throw new ApiError(0, "некорректно_ответ", "");
      }
      confirmed = true; hostCreateIntent = null; hostCreateNotice = "Запись создана. Повторная отправка не нужна."; renderHostCreation();
      await intent.onConfirmed(result);
    } catch (error) {
      const unknown = !error.status || error.status >= 500 || [408, 499].includes(error.status) || error.code === "некорректно_ответ";
      if (!confirmed && hostCreateIntent === intent && !retrying && !unknown) hostCreateIntent = null;
      if (error.status === 403) {
        if (hostCreateIntent === intent) clearHostCreation();
        if (intent.path !== "workspaces") resetRegistry();
      }
      handleError(error);
      if (confirmed) hostCreateNotice = "Запись создана, но список не обновился. Обновите список, не создавая запись заново.";
      renderHostCreation();
    } finally { setBusy(false); updateHostCreationControls(); }
  }

  function publishModuleLock(name, value) {
    moduleLocks[name] = !!value;
    applyModuleLocks();
  }

  function applyModuleLocks() {
    for (const [key, module, rootId] of [["inventory", inventory, "inventory-app"], ["materials", workMaterials, "work-materials-app"],
      ["orders", workOrders, "work-orders-app"], ["hydrology", hydrology, "hydrology-app"], ["dispatch", dispatchModule, "dispatch-app"],
      ["operations", operations, "operations-app"], ["documents", documents, "documents-app"], ["identity", identityAccount, "identity-account"],
      ["subscriber", subscriberWater, "subscriber-water-app"], ["public", publicEditor, "public-editor-app"], ["lab", lab, "lab-app"], ["labStaff", labStaff, "lab-staff-app"]]) {
      const locked = Object.entries(moduleLocks).some(([other, active]) => other !== key && active);
      module?.setExternalMutationLock?.(busy || locked);
      if ($(rootId)) $(rootId).inert = busy || locked;
    }
    const pending = Object.values(moduleLocks).some(Boolean);
    ui.refreshButton.disabled = busy || pending;
    ui.workspaceSelect.disabled = busy || pending || !state.workspaces.length && !selectedWorkspace();
    const note = $("module-lock-notice"); if (note) note.hidden = !pending;
  }

  function requireMutationScope(method, owner = "host") {
    if (method !== "GET" && Object.entries(moduleLocks).some(([key, locked]) => key !== owner && locked))
      throw new ApiError(409, "ожидание_другое_операция", "");
  }

  function moduleRequest(owner) {
    return (path, options = {}) => request(path, { ...options, moduleOwner: owner });
  }

  class ApiError extends Error {
    constructor(status, code, requestId) {
      super(code);
      this.status = status;
      this.code = code;
      this.requestId = requestId;
    }
  }

  function responseErrorCode(value) {
    const code = typeof value?.error?.code === "string" ? value.error.code : value?.error;
    return typeof code === "string" && /^[A-Za-zА-Яа-яЁё0-9_.-]{1,160}$/.test(code) ? code : "хттп_ошибка";
  }

  function invalidateHostContext() {
    clearHostCreation();
    contextRendered = false;
    hostEpoch++;
    clearTimeout(authorityTimer); authorityTimer = null;
    state.authority = null;
    for (const controller of hostRequests) controller.abort();
    hostRequests.clear(); listPages.clear();
    lab?.reset(); labStaff?.reset();
    clearInventoryContext(); clearWorkMaterialsContext();
    resetCustomer(); resetMeterAll(); resetRegistry(); resetWater(); resetDispatch();
    ui.membershipsBody.replaceChildren(); ui.sessionsBody.replaceChildren();
    for (const id of ["areas-list", "incoming-list", "outgoing-list"]) $(id).replaceChildren();
    identityAccount?.clear(); documents?.reset(); subscriberWater?.reset(); dispatchModule?.reset();
    operations?.reset?.(); operations?.clear?.(); publicEditor?.clear();
    state = { ...state, workspaces: [], workspaceId: "", workspace: null, authority: null, memberships: [], areas: [], incoming: [], outgoing: [], sessions: [], sessionsLoaded: false };
    ui.workspaceSelect.replaceChildren();
    for (const control of [ui.roleTarget, ui.roleArea, ui.invitationArea]) control.replaceChildren();
    for (const id of ["identity-account", "documents", "subscriber-water-extra", "dispatch-center", "operations", "public-editor"]) if ($(id)) $(id).hidden = true;
    for (const id of ["documents-nav", "subscriber-water-nav", "dispatch-nav", "operations-nav", "public-editor-nav"]) if ($(id)) $(id).hidden = true;
    document.querySelectorAll(".portal-page-controls").forEach(node => node.remove());
  }

  function showNotice(message, isError = false) {
    $("notice-text").textContent = message;
    $("notice").classList.toggle("error", isError);
    $("notice").hidden = false;
  }

  function clearNotice() {
    $("notice").hidden = true;
    $("notice-text").textContent = "";
  }

  async function request(path, options = {}) {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("#") || /(?:\.\.|:|\\)/.test(path.split("?")[0])) throw new ApiError(400, "некорректно_запрос", "");
    const epoch = hostEpoch;
    const headers = new Headers(options.headers || {});
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    headers.set("Accept", "application/json");
    const method = options.method || "GET";
    requireMutationScope(method, options.moduleOwner);
    if (method !== "GET") headers.set("X-Vodokanal-Request", "1");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    let response;
    let data = null;
    const controller = new AbortController();
    hostRequests.add(controller);
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetch(API + path, {
        method, headers, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      try { data = await response.json(); }
      catch (error) {
        if (controller.signal.aborted) throw error;
      }
    } catch (_) {
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      throw new ApiError(0, controller.signal.aborted ? "таймаут_ошибка" : "сеть_ошибка", "");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      hostRequests.delete(controller);
    }
    if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
    if (controller.signal.aborted) throw new ApiError(0, "таймаут_ошибка", "");
    const code = responseErrorCode(data);
    const requestId = data && typeof data.requestId === "string"
      ? data.requestId : response.headers.get("X-Request-ID") || "";
    if (!response.ok) {
      const error = new ApiError(response.status, code, requestId);
      const retry = response.headers.get("Retry-After"); if (/^\d{1,6}$/.test(retry || "")) error.retryAfter = Number(retry);
      throw error;
    }
    if (data === null) throw new ApiError(response.status, "некорректно_ответ", requestId);
    return data;
  }

  async function requestList(path, more = false) {
    const previous = listPages.get(path), epoch = hostEpoch;
    if (more && (!previous || !previous.hasMore)) throw new ApiError(409, "страница_контекст_изменено", "");
    const url = new URL(path, "http://portal.invalid/");
    url.searchParams.set("limit", "25");
    if (more) url.searchParams.set("cursor", previous.nextCursor);
    const value = await request(url.pathname.slice(1) + url.search.replace(/\+/g, "%20"));
    if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
    if (Array.isArray(value)) {
      if (more || value.length > 1000) throw new ApiError(200, "некорректно_ответ", "");
      pendingListPages.set(value, { path, epoch, items: value, hasMore: false, nextCursor: "", legacy: true });
      return value;
    }
    if (!value || !Array.isArray(value.items) || value.items.length > 25 || value.limit !== 25 || typeof value.hasMore !== "boolean" ||
        typeof value.nextCursor !== "string" || value.nextCursor.length > 256 || value.hasMore && (value.items.length !== 25 || !value.nextCursor || more && value.nextCursor === previous?.nextCursor) ||
        !value.hasMore && value.nextCursor !== "") throw new ApiError(200, "некорректно_ответ", "");
    const items = more ? [...previous.items, ...value.items] : value.items;
    const ids = items.map(row => row?.id || (typeof row?.entityId === "string" && Number.isSafeInteger(row.revision) ? row.entityId + "|" + row.revision : ""));
    if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new ApiError(200, "некорректно_ответ", "");
    pendingListPages.set(items, { path, epoch, items, hasMore: value.hasMore, nextCursor: value.nextCursor, legacy: false });
    return items;
  }

  function listContinuation(anchor, path, onMore, label = "Загрузить ещё", validatedItems = null) {
    const candidate = validatedItems && pendingListPages.get(validatedItems);
    if (candidate && candidate.path === path && candidate.epoch === hostEpoch) {
      listPages.set(path, candidate); pendingListPages.delete(validatedItems);
    }
    const target = typeof anchor === "string" ? $(anchor) : anchor;
    if (!target) return;
    const key = "pages-" + target.id;
    document.getElementById(key)?.remove();
    const page = listPages.get(path);
    if (!page) return;
    const box = document.createElement("div"); box.id = key; box.className = "portal-page-controls";
    const note = document.createElement("p"); note.className = "muted";
    note.textContent = "Загружено: " + page.items.length + (page.legacy ? ". Сервер вернул прежний формат; полнота списка не подтверждена." : page.hasMore ? ". Есть следующая страница." : ". Продолжения на момент чтения нет.");
    box.append(note);
    if (page.hasMore) {
      const button = document.createElement("button"); button.type = "button"; button.className = "button secondary"; button.textContent = label; button.disabled = busy;
      button.addEventListener("click", async () => {
        if (busy || !state.me) return;
        const epoch = hostEpoch; setBusy(true);
        try {
          await onMore();
          const replacement = document.getElementById(key);
          if (epoch === hostEpoch && replacement) { const focus = replacement.querySelector("button") || replacement; focus.tabIndex = focus.tabIndex < 0 ? -1 : focus.tabIndex; focus.focus(); }
        }
        catch (error) { handleError(error); }
        finally { if (epoch === hostEpoch) setBusy(false); }
      });
      box.append(button);
    }
    target.after(box);
  }

  async function requestRegistryCSV(path) {
    const epoch = hostEpoch;
    const controller = new AbortController();
    hostRequests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(API + path, {
        method: "GET", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: new Headers({ Accept: "text/csv" }), signal: controller.signal
      });
      if (!response.ok) {
        let data = null;
        try { data = await response.json(); }
        catch (error) { if (controller.signal.aborted) throw error; }
        throw new ApiError(response.status, responseErrorCode(data),
          typeof data?.requestId === "string" ? data.requestId : response.headers.get("X-Request-ID") || "");
      }
      const contentType = response.headers.get("Content-Type") || "";
      if (!/^text\/csv(?:;|$)/i.test(contentType) || !/(?:^|;)\s*charset\s*=\s*"?utf-8"?(?:;|$)/i.test(contentType)) {
        throw new ApiError(response.status, "некорректно_ответ", "");
      }
      const blob = await response.blob();
      const prefix = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
      const hasBOM = prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf;
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      return new Blob(hasBOM ? [blob] : ["\uFEFF", blob], { type: "text/csv;charset=utf-8" });
    } catch (error) {
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, controller.signal.aborted ? "таймаут_ошибка" : "сеть_ошибка", "");
    } finally { clearTimeout(timeout); hostRequests.delete(controller); }
  }

  async function requestLabBinary(path, format, signal) {
    const epoch = hostEpoch;
    const route = /^lab\/(?:my|technician|approver)\/samples\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/protocol\.(pdf|csv)\?version=(?:[0-9]|1[0-9]|20)$/i.exec(path);
    if (!route || !["pdf", "csv"].includes(format) || route[1] !== format) throw new ApiError(0, "некорректно_ответ", "");
    const controller = new AbortController();
    hostRequests.add(controller);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(cancel, 20000);
    try {
      const response = await fetch(API + path, {
        method: "GET", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: new Headers({ Accept: format === "pdf" ? "application/pdf" : "text/csv" }), signal: controller.signal
      });
      const limit = response.ok ? 4 * 1024 * 1024 : 16384;
      const contentLength = response.headers.get("Content-Length");
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > limit) {
        controller.abort();
        throw new ApiError(response.status, "кабинет_лаборатория_экспорт_слишком_большое", "");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(response.status, "некорректно_ответ", "");
      const parts = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > limit) {
            controller.abort();
            throw new ApiError(response.status, "кабинет_лаборатория_экспорт_слишком_большое", "");
          }
          parts.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      if (controller.signal.aborted) throw new ApiError(0, "таймаут_ошибка", "");
      if (!response.ok) {
        let data = null;
        try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch (_) {  }
        throw new ApiError(response.status, responseErrorCode(data),
          typeof data?.requestId === "string" ? data.requestId : response.headers.get("X-Request-ID") || "");
      }
      const contentType = response.headers.get("Content-Type") || "";
      if (format === "pdf") {
        if (!/^application\/pdf(?:;|$)/i.test(contentType) || length < 5 ||
            bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70 || bytes[4] !== 45) {
          throw new ApiError(response.status, "некорректно_ответ", "");
        }
        return new Blob([bytes], { type: "application/pdf" });
      }
      if (!/^text\/csv(?:;|$)/i.test(contentType) || !/(?:^|;)\s*charset\s*=\s*"?utf-8"?(?:;|$)/i.test(contentType) || !length) {
        throw new ApiError(response.status, "некорректно_ответ", "");
      }
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (_) { throw new ApiError(response.status, "некорректно_ответ", ""); }
      const hasBOM = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      return new Blob(hasBOM ? [bytes] : ["\uFEFF", bytes], { type: "text/csv;charset=utf-8" });
    } catch (error) {
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, controller.signal.aborted ? "таймаут_ошибка" : "сеть_ошибка", "");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      hostRequests.delete(controller);
    }
  }

  function packageJSON(source) {
    const value = JSON.parse(source);
    const stack = [];
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (char === '"') {
        const start = i++;
        for (; i < source.length; i++) {
          if (source[i] === "\\") { i++; continue; }
          if (source[i] === '"') break;
        }
        const top = stack[stack.length - 1];
        if (top?.object && top.key) {
          const name = JSON.parse(source.slice(start, i + 1));
          if (top.names.has(name)) throw new ApiError(200, "некорректно_ответ", "");
          top.names.add(name);
          top.key = false;
        }
      } else if (char === "{" || char === "[") {
        stack.push({ object: char === "{", key: true, names: new Set() });
        if (stack.length > 64) throw new ApiError(200, "некорректно_ответ", "");
      } else if (char === "}" || char === "]") stack.pop();
      else if (char === "," && stack[stack.length - 1]?.object) stack[stack.length - 1].key = true;
    }
    if (value === null || typeof value !== "object") throw new ApiError(200, "некорректно_ответ", "");
    return value;
  }

  async function requestPackage(path, options = {}, binaryTypes = null) {
    requireMutationScope(options.method || "GET", options.moduleOwner);
    const epoch = hostEpoch;
    const controller = new AbortController(), cancel = () => controller.abort();
    hostRequests.add(controller);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timeout = setTimeout(cancel, 20000);
    try {
      const method = options.method || "GET", headers = new Headers(options.headers || {});
      if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
      headers.set("Accept", binaryTypes ? binaryTypes.join(", ") : "application/json");
      if (method !== "GET") headers.set("X-Vodokanal-Request", "1");
      if (options.body !== undefined) headers.set("Content-Type", "application/json");
      const response = await fetch(API + path, { method, headers, credentials: "same-origin", mode: "same-origin",
        cache: "no-store", redirect: "error", signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body) });
      const limit = !response.ok ? 16384 : binaryTypes ? 5242880 : 4194304;
      const declared = response.headers.get("Content-Length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        cancel(); throw new ApiError(response.status, "некорректно_ответ", "");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(response.status, "некорректно_ответ", "");
      const chunks = []; let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > limit) { cancel(); throw new ApiError(response.status, "некорректно_ответ", ""); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (!length) throw new ApiError(response.status, "некорректно_ответ", "");
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      if (controller.signal.aborted) throw new ApiError(0, "таймаут_ошибка", "");
      const mime = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (!response.ok) {
        let body = null;
        try { body = packageJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch (_) {  }
        throw new ApiError(response.status, responseErrorCode(body),
          typeof body?.requestId === "string" ? body.requestId : response.headers.get("X-Request-ID") || "");
      }
      if (!binaryTypes) {
        if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
        if (mime !== "application/json") throw new ApiError(response.status, "некорректно_ответ", "");
        try { return packageJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch (_) { throw new ApiError(response.status, "некорректно_ответ", ""); }
      }
      const disposition = /^attachment;\s*filename="([A-Za-z0-9][A-Za-z0-9 _.-]{0,119})"$/i.exec(response.headers.get("Content-Disposition") || "");
      if (!binaryTypes.includes(mime) || !disposition || disposition[1].includes("..") ||
          (response.headers.get("X-Content-Type-Options") || "").trim().toLowerCase() !== "nosniff" ||
          !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get("Cache-Control") || "")) throw new ApiError(response.status, "некорректно_ответ", "");
      if (mime === "application/pdf" && String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-" ||
          mime === "image/png" && [137,80,78,71,13,10,26,10].some((n, i) => bytes[i] !== n) ||
          mime === "image/jpeg" && (bytes[0] !== 255 || bytes[1] !== 216)) throw new ApiError(response.status, "некорректно_ответ", "");
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      return { blob: new Blob([bytes], { type: mime }), contentType: mime, filename: disposition[1] };
    } catch (error) {
      if (epoch !== hostEpoch) throw new ApiError(0, "контекст_изменено", "");
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, controller.signal.aborted ? "таймаут_ошибка" : "сеть_ошибка", "");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      hostRequests.delete(controller);
    }
  }

  function syncLabContext() {
    if (!lab) return;
    const workspace = selectedWorkspace();
    const areas = state.areas.map((area) => ({ id: area.id, name: area.name, state: area.state }));
    const canCreateAreaIds = state.me && workspace?.state === "Active" ? areas.filter((area) => area.state === "Active" &&
      roleMemberships().some((row) => row.accountId === state.me.accountId && row.workspaceId === workspace.id && currentMembership(row) &&
        ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && row.areaId === area.id)))).map((area) => area.id) : [];
    lab.syncContext({ accountId: state.me?.accountId || "", workspaceId: state.workspaceId, areas, canCreateAreaIds });
  }

  function syncLabStaffContext() {
    const workspace = selectedWorkspace();
    const areas = state.areas.map((area) => ({ id: area.id, name: area.name, state: area.state }));
    const permittedAreas = (role) => state.me && workspace?.state === "Active" ? areas.filter((area) => area.state === "Active" &&
      roleMemberships().some((row) => row.accountId === state.me.accountId && row.workspaceId === workspace.id && row.role === role && currentMembership(row) &&
        ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && row.areaId === area.id)))).map((area) => area.id) : [];
    const technicianAreaIds = permittedAreas("LabTechnician");
    const approverAreaIds = permittedAreas("LabApprover");
    const available = !!(technicianAreaIds.length || approverAreaIds.length);
    $("lab-staff").hidden = !available;
    $("lab-staff-nav").hidden = !available;
    labStaff?.syncContext({ accountId: state.me?.accountId || "", actorId: state.me?.actorId || "",
      workspaceId: state.workspaceId, areas, technicianAreaIds, approverAreaIds });
  }

  function inventoryContext(snapshot = state) {
    const workspace = snapshot.workspace?.id === snapshot.workspaceId ? snapshot.workspace : snapshot.workspaces.find((row) => row.id === snapshot.workspaceId);
    const areas = snapshot.areas.filter((row) => row.workspaceId === snapshot.workspaceId)
      .map((row) => ({ id: row.id, name: row.name, state: row.state }));
    const storekeeperAreaIds = snapshot.me && workspace?.state === "Active" ? areas.filter((area) => area.state === "Active" &&
      roleMemberships(snapshot).some((row) => row.accountId === snapshot.me.accountId && row.workspaceId === workspace.id &&
        row.role === "Storekeeper" && currentMembership(row) &&
        ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && row.areaId === area.id))))
      .map((area) => area.id) : [];
    return { accountId: snapshot.me?.accountId || "", actorId: snapshot.me?.actorId || "",
      workspaceId: snapshot.workspaceId, areas, storekeeperAreaIds };
  }

  function hideInventory() {
    if (!inventory) return;
    const focusInside = $("inventory").contains(document.activeElement);
    $("inventory").hidden = true;
    $("inventory-nav").hidden = true;
    if (focusInside) $("main").focus();
  }

  function clearInventoryContext() {
    if (!inventory) return;
    clearTimeout(inventoryLeaseTimer);
    inventoryLeaseTimer = null;
    inventoryAccessRejected = true;
    inventory.syncContext({ accountId: "", actorId: "", workspaceId: "", areas: [], storekeeperAreaIds: [] });
    inventory.setExternalBusy(true);
    hideInventory();
  }

  function syncInventoryContext() {
    if (!inventory) return;
    clearTimeout(inventoryLeaseTimer);
    inventoryLeaseTimer = null;
    if (inventoryAccessRejected) { inventory.setExternalBusy(true); return; }
    const context = inventoryContext();
    inventory.syncContext(context);
    const available = context.storekeeperAreaIds.length > 0;
    if (available) { $("inventory").hidden = false; $("inventory-nav").hidden = false; }
    else hideInventory();
    const expirations = roleMemberships().filter((row) => row.accountId === context.accountId &&
      row.workspaceId === context.workspaceId && row.role === "Storekeeper" && currentMembership(row) &&
      ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && context.storekeeperAreaIds.includes(row.areaId))))
      .map((row) => row.expiresAt && !/^0*1-01-01/.test(row.expiresAt)
        ? Date.parse(row.expiresAt.endsWith("Z") ? row.expiresAt : row.expiresAt + "Z") : NaN).filter(Number.isFinite);
    if (available && expirations.length) inventoryLeaseTimer = setTimeout(syncInventoryContext,
      Math.min(2147483647, Math.max(1, Math.min(...expirations) - Date.now() + 1)));
  }

  async function requestInventory(path, options = {}) {
    const context = inventoryContext();
    const scope = options.body || Object.fromEntries(new URLSearchParams(path.split("?")[1] || ""));
    if (inventoryAccessRejected || !context.accountId || !context.actorId ||
        !path.startsWith("inventory/") || scope.workspaceId !== context.workspaceId ||
        !context.storekeeperAreaIds.includes(scope.areaId)) {
      syncInventoryContext();
      throw new ApiError(403, "кабинет_склад_граница_отказано", "");
    }
    return request(path, { ...options, moduleOwner: "inventory" });
  }

  function workMaterialsContext(snapshot = state) {
    const workspace = snapshot.workspace?.id === snapshot.workspaceId ? snapshot.workspace : snapshot.workspaces.find((row) => row.id === snapshot.workspaceId);
    const areas = snapshot.areas.filter((row) => row.workspaceId === snapshot.workspaceId)
      .map((row) => ({ id: row.id, name: row.name, state: row.state }));
    const allowed = (role) => snapshot.me && workspace?.state === "Active" ? areas.filter((area) => area.state === "Active" &&
      roleMemberships(snapshot).some((row) => row.accountId === snapshot.me.accountId && row.workspaceId === workspace.id &&
        row.role === role && currentMembership(row) &&
        ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && row.areaId === area.id)))).map((area) => area.id) : [];
    return { accountId: snapshot.me?.accountId || "", actorId: snapshot.me?.actorId || "", workspaceId: snapshot.workspaceId,
      areas, dispatcherAreaIds: allowed("Dispatcher"), crewLeaderAreaIds: allowed("CrewLeader") };
  }

  function hideWorkMaterials() {
    if (!workMaterials) return;
    const focusInside = $("work-materials").contains(document.activeElement);
    $("work-materials").hidden = true;
    $("work-materials-nav").hidden = true;
    if (focusInside) $("main").focus();
  }

  function clearWorkMaterialsContext() {
    if (!workMaterials) return;
    clearTimeout(workMaterialsLeaseTimer);
    workMaterialsLeaseTimer = null;
    workMaterialsAccessRejected = true;
    workMaterials.syncContext({ accountId: "", actorId: "", workspaceId: "", areas: [], dispatcherAreaIds: [], crewLeaderAreaIds: [] });
    workMaterials.setExternalBusy(true);
    hideWorkMaterials();
  }

  function syncWorkMaterialsContext() {
    if (!workMaterials) return;
    clearTimeout(workMaterialsLeaseTimer);
    workMaterialsLeaseTimer = null;
    if (workMaterialsAccessRejected) { workMaterials.setExternalBusy(true); return; }
    const context = workMaterialsContext();
    workMaterials.syncContext(context);
    const ids = [...context.dispatcherAreaIds, ...context.crewLeaderAreaIds];
    if (ids.length) { $("work-materials").hidden = false; $("work-materials-nav").hidden = false; }
    else hideWorkMaterials();
    const expirations = roleMemberships().filter((row) => row.accountId === context.accountId && row.workspaceId === context.workspaceId &&
      ["Dispatcher", "CrewLeader"].includes(row.role) && currentMembership(row) &&
      ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && ids.includes(row.areaId))))
      .map((row) => row.expiresAt && !/^0*1-01-01/.test(row.expiresAt)
        ? Date.parse(row.expiresAt.endsWith("Z") ? row.expiresAt : row.expiresAt + "Z") : NaN).filter(Number.isFinite);
    if (ids.length && expirations.length) workMaterialsLeaseTimer = setTimeout(syncWorkMaterialsContext,
      Math.min(2147483647, Math.max(1, Math.min(...expirations) - Date.now() + 1)));
  }

  async function requestWorkMaterials(path, options = {}) {
    const context = workMaterialsContext();
    const scope = options.body || Object.fromEntries(new URLSearchParams(path.split("?")[1] || ""));
    const method = options.method || "GET";
    const route = path.split("?")[0];
    const fixedRoute = method === "GET" ? /^work-materials\/orders(?:\/[0-9a-f-]{36}(?:\/(?:requests|documents))?)?$/.test(route)
      : method === "POST" && /^work-materials\/(requests|consumption|corrections)$/.test(route);
    if (workMaterialsAccessRejected || !context.accountId || !context.actorId || !fixedRoute ||
        scope.workspaceId !== context.workspaceId || ![...context.dispatcherAreaIds, ...context.crewLeaderAreaIds].includes(scope.areaId)) {
      syncWorkMaterialsContext();
      throw new ApiError(403, "кабинет_наряд_материалы_граница_отказано", "");
    }
    return request(path, { ...options, moduleOwner: "materials" });
  }

  function hidePackageSection(kind) {
    const section = $(kind === "orders" ? "work-orders" : "hydrology");
    if (!section) return;
    const inside = section.contains(document.activeElement);
    section.hidden = true;
    $(kind === "orders" ? "work-orders-nav" : "hydrology-nav").hidden = true;
    if (inside) $("main").focus();
  }

  function clearPackageContext(kind) {
    const module = kind === "orders" ? workOrders : hydrology;
    if (kind === "orders") { clearTimeout(workOrdersLeaseTimer); workOrdersAccessRejected = true; }
    else { clearTimeout(hydrologyLeaseTimer); hydrologyAccessRejected = true; }
    module?.syncContext({ accountId: "", actorId: "", workspaceId: "", areas: [], dispatcherAreaIds: [], crewLeaderAreaIds: [], permissionEpoch: packagePermissionEpoch });
    module?.setExternalBusy(true);
    hidePackageSection(kind);
  }

  function syncPackageContext(kind) {
    const module = kind === "orders" ? workOrders : hydrology;
    if (!module) return;
    if (kind === "orders") clearTimeout(workOrdersLeaseTimer); else clearTimeout(hydrologyLeaseTimer);
    if (kind === "orders" ? workOrdersAccessRejected : hydrologyAccessRejected) { module.setExternalBusy(true); return; }
    const context = { ...workMaterialsContext(), permissionEpoch: packagePermissionEpoch };
    if (kind === "hydrology") delete context.crewLeaderAreaIds;
    module.syncContext(context);
    const available = kind === "orders" ? !!(context.accountId && context.actorId) : context.dispatcherAreaIds.length > 0;
    const section = kind === "orders" ? "work-orders" : "hydrology";
    if (available) { $(section).hidden = false; $(section + "-nav").hidden = false; }
    else hidePackageSection(kind);
    const roles = kind === "orders" ? ["Dispatcher", "CrewLeader"] : ["Dispatcher"];
    const ends = roleMemberships().filter(row => row.accountId === context.accountId && row.workspaceId === context.workspaceId &&
      roles.includes(row.role) && currentMembership(row)).map(row => row.expiresAt && !/^0*1-01-01/.test(row.expiresAt)
        ? Date.parse(row.expiresAt.endsWith("Z") ? row.expiresAt : row.expiresAt + "Z") : NaN).filter(Number.isFinite);
    if (available && ends.length) {
      const timer = setTimeout(() => syncPackageContext(kind), Math.min(2147483647, Math.max(1, Math.min(...ends) - Date.now() + 1)));
      if (kind === "orders") workOrdersLeaseTimer = timer; else hydrologyLeaseTimer = timer;
    }
  }

  function packagePath(path) {
    if (typeof path !== "string" || path.length > 2048 || /[\\#\r\n]/.test(path)) throw new ApiError(0, "некорректно_ответ", "");
    const [route, query = "", extra] = path.split("?");
    if (extra !== undefined) throw new ApiError(0, "некорректно_ответ", "");
    const params = new URLSearchParams(query);
    if (new Set(params.keys()).size !== [...params.keys()].length) throw new ApiError(0, "некорректно_ответ", "");
    return { route, params };
  }

  function workRoute(path, method = "GET", binary = false) {
    const { route, params } = packagePath(path), id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const match = pattern => new RegExp("^(?:" + pattern + ")$", "i").test(route);
    const allowed = binary ? method === "GET" && !params.size && match(`work/(?:photos/${id}/content|orders/${id}/(?:print/(?:order|act)|appendix/export|appendix-versions/(?:[1-9][0-9]{0,2}|1000)/export))`) :
      method === "GET" ? match(`work/(?:setup|people|orders|permits|service-orders(?:/${id})?|orders/${id}(?:/(?:history|execution(?:/versions/(?:[1-9][0-9]?|100))?|photos|permit-options|appendix|appendix-versions/(?:[1-9][0-9]{0,2}|1000)))?)|dispatch/(?:incidents|requests)`) :
      method === "POST" && !params.size && match(`work/(?:crews|resources|orders|service-orders|crews/${id}/members|orders/${id}/(?:actions/assign|leader-actions/(?:accept|decline|start|pause|resume|submit)|review-actions/(?:approve|rework|close|cancel|restore)|permits|appendix-versions|photos)|permits/${id}/(?:responses/(?:accept|decline)|actions/revoke))`);
    if (!allowed || !state.me?.accountId || !state.me?.actorId || workOrdersAccessRejected) throw new ApiError(403, "кабинет_наряд_граница_отказано", "");
    if ([...params.keys()].some(key => !["workspaceId", "areaId", "limit", "cursor"].includes(key))) throw new ApiError(0, "некорректно_ответ", "");
    return { route, params };
  }

  async function requestWorkOrders(path, options = {}) {
    const { route, params } = workRoute(path, options.method || "GET"), context = workMaterialsContext();
    const serviceOrders = route === "work/service-orders", serviceOrderDetail = /^work\/service-orders\//.test(route);
    const scoped = serviceOrders || /^(?:work\/(?:setup|people|orders|crews|resources)|dispatch\/(?:requests|incidents))$/.test(route);
    if (scoped) {
      const scope = options.body || Object.fromEntries(params);
      const allowedAreas = serviceOrders ? context.dispatcherAreaIds : [...context.dispatcherAreaIds, ...context.crewLeaderAreaIds];
      if (scope.workspaceId !== context.workspaceId || !allowedAreas.includes(scope.areaId)) {
        syncPackageContext("orders"); throw new ApiError(403, "кабинет_наряд_граница_отказано", "");
      }
    } else if (serviceOrderDetail) {
      if (params.size) throw new ApiError(0, "некорректно_ответ", "");
      if (!context.dispatcherAreaIds.length) {
        syncPackageContext("orders"); throw new ApiError(403, "кабинет_наряд_граница_отказано", "");
      }
    } else if ([...params.keys()].some(key => !["limit", "cursor"].includes(key))) throw new ApiError(0, "некорректно_ответ", "");
    return requestPackage(path, { ...options, moduleOwner: "orders" });
  }

  async function requestWorkBinary(path, options = {}) {
    const { route } = workRoute(path, "GET", true);
    return requestPackage(path, { signal: options.signal }, route.startsWith("work/photos/") ? ["image/jpeg", "image/png"] : ["application/pdf"]);
  }

  async function requestHydrology(path, options = {}) {
    const { route, params } = packagePath(path), method = options.method || "GET", context = workMaterialsContext();
    const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const pattern = method === "GET" ? `^hydrology/(?:reference|posts|posts/${id}/(?:series|history|settings/history))$` :
      method === "POST" ? `^hydrology/(?:posts|posts/${id}/(?:configuration|measurements|corrections|import|generate))$` : "(?!)";
    if (!new RegExp(pattern, "i").test(route) || hydrologyAccessRejected || !context.accountId || !context.actorId || !context.dispatcherAreaIds.length ||
        method === "POST" && params.size || [...params.keys()].some(key => !["workspaceId", "areaId", "from", "to", "afterTime", "measuredAt", "limit", "cursor", "riverCode"].includes(key))) {
      syncPackageContext("hydrology"); throw new ApiError(403, "кабинет_гидрология_граница_отказано", "");
    }
    const scope = options.body || Object.fromEntries(params);
    if ((scope.workspaceId !== undefined || scope.areaId !== undefined) &&
        (scope.workspaceId !== context.workspaceId || !context.dispatcherAreaIds.includes(scope.areaId))) throw new ApiError(403, "кабинет_гидрология_граница_отказано", "");
    return requestPackage(path, { ...options, moduleOwner: "hydrology" });
  }

  function errorMessage(error, loginAttempt = false) {
    let message = loginAttempt && error.status === 401 && error.code === "кабинет_аутентификация_требуется"
      ? "Не удалось войти. Проверьте имя пользователя и пароль 1С." : errors[error.code];
    if (!message && error.status === 401) message = loginAttempt
      ? "Не удалось войти. Проверьте имя пользователя и пароль 1С."
      : "Сессия недоступна. Войдите заново.";
    if (!message && error.status === 403) message = "Сервер отклонил действие: недостаточно прав.";
    if (!message && error.status === 404) message = "Запись отсутствует или недоступна вашей учётной записи.";
    if (!message && error.code === "сеть_ошибка") message = "Нет ответа от сервера. Проверьте соединение и повторите запрос.";
    if (!message && error.code === "таймаут_ошибка") message = "Сервер не ответил за 20 секунд. Повторите запрос позже.";
    if (!message && error.code === "некорректно_ответ") message = "Не удалось прочитать ответ сервера. Обновите данные; запись автоматически не повторяется.";
    if (!message && error.code === "ожидание_другое_операция") message = "В другом разделе осталась операция без подтверждённого результата. Сначала завершите её проверку или повторите ту же операцию.";
    if (!message && error.status === 429) message = "Слишком много запросов. " + (error.retryAfter ? "Повторите через " + error.retryAfter + " с." : "Подождите и повторите действие вручную.");
    if (!message) message = "Операция не выполнена. Обновите данные и повторите попытку.";
    if (error.requestId && /^[a-zA-Z0-9-]{1,64}$/.test(error.requestId)) message += " Код запроса: " + error.requestId;
    return message;
  }

  function setBusy(value) {
    value = Boolean(value || dashboardLoads > 0);
    busy = value;
    document.body.classList.toggle("busy", value);
    ui.loginButton.disabled = value;
    ui.username.disabled = value;
    ui.password.disabled = value;
    ui.logoutButton.disabled = value;
    ui.refreshButton.disabled = value;
    ui.workspaceSelect.disabled = value || state.workspaces.length === 0;
    ui.workspaceName.disabled = value || !state.me;
    ui.createButton.disabled = value || !state.me;
    ui.roleSelect.disabled = value || !isOwner();
    ui.assignButton.disabled = value || !isOwner();
    [ui.roleTarget, ui.roleScope, ui.areaName, ui.createAreaButton, ui.invitationRecipient,
      ui.invitationRole, ui.invitationScope, ui.invitationTTL, ui.createInvitationButton]
      .forEach((control) => { control.disabled = value || !isOwner(); });
    ui.roleArea.disabled = value || !isOwner() || ui.roleScope.value !== "Area" || state.areas.length === 0;
    ui.invitationArea.disabled = value || !isOwner() || ui.invitationScope.value !== "Area" || state.areas.length === 0;
    [ui.currentPassword, ui.newPassword, ui.confirmPassword, ui.passwordButton]
      .forEach((control) => { control.disabled = value || !state.me; });
    [ui.refreshSessionsButton, ui.revokeAllSessionsButton].forEach((control) => { control.disabled = value || !state.me; });
    const registryAccess = registryAreaAllowed(ui.registryArea.value);
    [ui.registryArea, ui.registryEntity, ui.registryFilterState, ui.registrySearch, ui.registryLoadButton]
      .forEach((control) => { control.disabled = value || !registryAccess; });
    registryInputs.forEach((input) => { input.disabled = value || !registryContextReady() || !!input.registryLocked; });
    ui.registryCreateButton.disabled = value || !registryContextReady() || registry.uncertain;
    ui.registryExportButton.disabled = value || !registryContextReady();
    ui.registryHistoryButton.disabled = value || !registryLifecycleReady();
    const lifecycleEditable = registryLifecycleEditable();
    [ui.lifecycleReason, ui.lifecycleButton, ...lifecycleInputs.values()].forEach((control) => { control.disabled = value || !lifecycleEditable; });
    [ui.customerRefreshButton, ui.customerAccountId, ui.customerRequestButton].forEach((control) => { control.disabled = value || !state.me; });
    const staffAccess = registryAreaAllowed(ui.customerStaffArea.value);
    [ui.customerStaffArea, ui.customerQueueButton, ui.customerStaffLinkId, ui.customerStaffLinkRevision, ui.customerStaffReason, ui.customerStaffRevokeButton]
      .forEach((control) => { control.disabled = value || !staffAccess; });
    customerReasons.forEach((input) => { input.disabled = value || !staffAccess; });
    [...actionButtons, ...sessionButtons, ...registryButtons, ...customerButtons, ...customerPendingButtons, ...waterButtons].forEach((button) => { button.disabled = value; });
    [w.area, w.loadButton].forEach((control) => { control.disabled = value || !waterAreaAllowed(w.area.value); });
    [w.setupKind, w.setupName, w.setupButton, w.point, w.source, w.receiptPoint, w.occurredAt, w.basis, w.quantity,
      w.orderPoint, w.recipient, w.orderQuantity, w.scheduledAt].forEach((control) => { control.disabled = value || !waterReady(); });
    w.pointLoadButton.disabled = value || !waterReady() || !waterSetupRef("points", w.point.value);
    [w.seedButton, w.receiptButton].forEach((control) => { control.disabled = value || !waterReady() || !waterSetupRef("sources", w.source.value) || !waterSetupRef("points", w.receiptPoint.value); });
    w.orderCreateButton.disabled = value || !waterReady() || !waterSetupRef("points", w.orderPoint.value) || !waterSetupRef("recipients", w.recipient.value);
    w.action.disabled = value || !waterReady() || water.stale || !waterLegalActions().length;
    w.actionButton.disabled = value || !waterReady() || water.stale || !waterLegalActions().some(([code]) => code === w.action.value);
    [w.returnQuantity, w.returnReason].forEach((control) => { control.disabled = value || w.actionButton.disabled || w.action.value !== "return"; });
    const meterStaffAccess = registryAreaAllowed(m.staffArea.value);
    [m.staffArea, m.staffLoadButton].forEach((control) => { control.disabled = value || !meterStaffAccess; });
    [m.passportName, m.passportType, m.manufacturer, m.model, m.serial, m.digits, m.coefficient, m.verification, m.passportCreateButton,
      m.installPassport, m.installAccount, m.installedAt, m.admittedAt, m.initialValue, m.installCreateButton]
      .forEach((control) => { control.disabled = value || !meterStaffReady(); });
    m.installCreateButton.disabled = value || !meterStaffReady() || !meterStaff.passports.some((passport) => passport.id === m.installPassport.value && meterLivePassport(passport)) ||
      !meterStaff.accounts.some((account) => account.id === m.installAccount.value && account.state === "Active");
    m.installPoint.disabled = true;
    m.mode.disabled = value || meterReading.phase === "unknown";
    m.accountSelect.disabled = value || !state.me || !meterAccounts().length;
    m.refreshAccountsButton.disabled = value || !state.me;
    m.loadInstallationsButton.disabled = value || !meterAccount(m.accountSelect.value);
    m.installationSelect.disabled = value || !meterView.installations.length;
    m.openInstallationButton.disabled = value || !meterView.installations.some((item) => item.id === m.installationSelect.value);
    [m.measuredAt, m.measuredTime, m.readingValue, m.readingSubmitButton]
      .forEach((control) => { control.disabled = value || !meterCanSubmit() || meterReading.phase !== "idle"; });
    m.retry.disabled = value || !state.me || meterReading.phase !== "unknown" || !meterCanSubmit();
    m.refreshReading.disabled = value || !state.me || !meterView.installation || meterReading.phase === "unknown";
    m.nextReading.disabled = value || !meterCanSubmit() || meterReading.phase !== "confirmed" || meterReading.refreshFailed;
    [m.proposedAt, m.proposedValue, m.correctionReason, m.correctionReading].forEach((control) => { control.disabled = value || !meterCanCorrect(); });
    m.correctionSubmitButton.disabled = value || !meterCanCorrect() || !meterView.readings.some((row) => row.state === "Accepted" && row.id === m.correctionReading.value);
    setDispatchBusy(value);
    setRequestFilesBusy(value);
    lab?.setExternalBusy(value);
    labStaff?.setExternalBusy(value);
    inventory?.setExternalBusy(value || inventoryAccessRejected);
    workMaterials?.setExternalBusy(value || workMaterialsAccessRejected);
    workOrders?.setExternalBusy(value || workOrdersAccessRejected);
    hydrology?.setExternalBusy(value || hydrologyAccessRejected);
    documents?.setExternalBusy(value); dispatchModule?.setExternalBusy(value); subscriberWater?.setExternalBusy?.(value); operations?.setExternalBusy?.(value);
    identityAccount?.setExternalBusy?.(value);
    publicEditor?.setExternalBusy?.(value);
    document.querySelectorAll(".portal-page-controls button").forEach(button => { button.disabled = value; });
    $("main").setAttribute("aria-busy", String(value));
    applyModuleLocks();
    updateHostCreationControls();
    if (!value && state.me) applyEntryRoute();
  }

  function extraContext() {
    const memberships = roleMemberships().filter(row => currentMembership(row));
    return { accountId: state.me?.accountId || "", actorId: state.me?.actorId || "", workspaceId: state.workspaceId,
      areaId: "", roles: authorityCurrent() ? [...state.authority.roles] : [], memberships,
      areas: state.areas.filter(row => row.workspaceId === state.workspaceId && row.state === "Active"), permissionEpoch: hostEpoch };
  }

  function additionalSessionError(error) {
    if (error.status === 401 || noNativeSession(error)) { handleError(error); return true; }
    return false;
  }

  function syncAdditionalModules() {
    const context = extraContext(), signed = !!context.accountId;
    identityAccount?.setContext({ actorId: context.actorId, accountId: context.accountId, login: state.me?.nativeName || "" });
    documents?.syncContext(context); subscriberWater?.setContext(context);
    const areaIds = role => context.areas.filter(area => context.memberships.some(row => row.role === role &&
      (row.areaScope === "All" && !row.areaId || row.areaScope === "Area" && row.areaId === area.id))).map(area => area.id);
    dispatchModule?.syncContext({ ...context, dispatcherAreaIds: areaIds("Dispatcher"), ownerAreaIds: isOwner() ? context.areas.map(area => area.id) : [] });
    operations?.syncContext?.(context); operations?.setContext?.(context);
    const views = [["identity-account", null, !!identityAccount], ["documents", "documents-nav", !!documents],
      ["subscriber-water-extra", "subscriber-water-nav", !!subscriberWater], ["dispatch-center", "dispatch-nav", !!dispatchModule],
      ["operations", "operations-nav", !!operations], ["public-editor", "public-editor-nav", !!publicEditor && isOwner()]];
    for (const [section, nav, enabled] of views) {
      if ($(section)) $(section).hidden = !signed || !enabled;
      if (nav && $(nav)) $(nav).hidden = !signed || !enabled;
    }
    $("dispatch").hidden = true;
    $("registry").hidden = !context.areas.some(area => registryAreaAllowed(area.id));
    $("water").hidden = !context.areas.some(area => waterAreaAllowed(area.id));
    for (const id of ["registry", "water"]) {
      const link = document.querySelector('.navigation a[href="#' + id + '"]'); if (link) link.hidden = $(id).hidden;
    }
    if (!signed || !isOwner()) publicEditor?.clear();
    const missing = [[identityAccount, "контакт и восстановление"], [documents, "документы"], [subscriberWater, "приборы и доставка"],
      [dispatchModule, "обращения и диспетчерская"], [operations, "уведомления"], [publicEditor, "публикации"]].filter(([module]) => !module).map(([, label]) => label);
    const availability = $("module-availability-note");
    if (availability) { availability.hidden = !signed || missing.length === 0; availability.textContent = missing.length ? "Не загружены разделы: " + missing.join(", ") + ". Обновите страницу; если ошибка сохраняется, сообщите оператору. Данные этих разделов не запрашивались." : ""; }
  }

  async function requestAdditionalBinary(path, mime, signal) {
    const { route, params } = packagePath(path);
    const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const allowed = new RegExp(`^(?:documents/${id}/download|exports/${id}/download|meter-readings/${id}/photo/download|my/request-files/${id}/versions/[1-9][0-9]?/content)$`, "i");
    if (!state.me || !allowed.test(route) || [...params.keys()].some(key => !["version"].includes(key)) || params.has("version") && !/^[1-9]\d{0,8}$/.test(params.get("version"))) throw new ApiError(403, "скачивание_запрещено", "");
    const types = ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"];
    if (mime && !types.includes(mime)) throw new ApiError(400, "некорректно_запрос", "");
    return (await requestPackage(path, { signal }, mime ? [mime] : types)).blob;
  }

  async function requestDispatchBinary(path, options = {}) {
    const { route, params } = packagePath(path), id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    if (!state.me || (options.method && options.method !== "GET") || options.body ||
        !new RegExp(`^(?:my|dispatch)/(?:request-files/${id}/(?:content|versions/[1-9][0-9]{0,8}/content)|requests/${id}/guest-photo)$`, "i").test(route) ||
        params.size) throw new ApiError(403, "скачивание_запрещено", "");
    return requestPackage(path, options, ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);
  }

  async function downloadAdditional(path, filename, signal) {
    const epoch = hostEpoch, blob = await requestAdditionalBinary(path, undefined, signal);
    if (epoch !== hostEpoch || signal?.aborted) return;
    const name = typeof filename === "string" && filename.length <= 180 && !/[\\/\u0000-\u001f]/.test(filename) ? filename : "document";
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectedWorkspace() {
    return state.workspace?.id === state.workspaceId ? state.workspace : state.workspaces.find((workspace) => workspace.id === state.workspaceId);
  }

  function currentMembership(row) {
    if (row.state !== "Active") return false;
    if (!row.expiresAt || /^0*1-01-01/.test(row.expiresAt)) return true;
    const expires = Date.parse(row.expiresAt.endsWith("Z") ? row.expiresAt : row.expiresAt + "Z");
    return Number.isFinite(expires) && expires > Date.now();
  }

  function authorityCurrent(snapshot = state) {
    const authority = snapshot.authority;
    return !!(snapshot.me && authority && authority.accountId === snapshot.me.accountId && authority.workspaceId === snapshot.workspaceId &&
      (!authority.expiresAt || Date.parse(authority.expiresAt.endsWith("Z") ? authority.expiresAt : authority.expiresAt + "Z") > Date.now()));
  }

  function roleMemberships(snapshot = state) {
    if (!authorityCurrent(snapshot)) return [];
    const authority = snapshot.authority, result = [];
    const add = (role, areaId) => result.push({ accountId: authority.accountId, workspaceId: authority.workspaceId, role,
      areaScope: areaId ? "Area" : "All", areaId, state: "Active", expiresAt: authority.expiresAt });
    for (const role of authority.workspaceRoles) add(role, "");
    for (const area of authority.areas) for (const role of area.roles) if (!authority.workspaceRoles.includes(role)) add(role, area.id);
    return result;
  }

  function isOwner() { return authorityCurrent() && state.authority.owner && selectedWorkspace()?.state === "Active"; }

  async function readAuthority(snapshot) {
    if (!snapshot.workspaceId) return null;
    const ids = snapshot.areas.filter(area => area.state === "Active").map(area => area.id), chunks = [];
    for (let offset = 0; offset < ids.length; offset += 100) chunks.push(ids.slice(offset, offset + 100));
    if (!chunks.length) chunks.push([]);
    let combined = null;
    const roleList = values => Array.isArray(values) && values.length <= 12 && new Set(values).size === values.length &&
      values.every(role => role === "WorkspaceOwner" || roles.has(role));
    const time = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(value) &&
      Number.isFinite(Date.parse(value.endsWith("Z") ? value : value + "Z"));
    for (const areaIds of chunks) {
      const value = await request("workspaces/" + encodeURIComponent(snapshot.workspaceId) + "/authority?" + new URLSearchParams({ areaIds: areaIds.join(",") }));
      if (!value || value.accountId !== snapshot.me.accountId || value.workspaceId !== snapshot.workspaceId || typeof value.owner !== "boolean" ||
          !value.workspace || value.workspace.id !== snapshot.workspaceId || typeof value.workspace.name !== "string" ||
          typeof value.workspace.ownerAccountId !== "string" || value.workspace.state !== "Active" || typeof value.workspace.profile !== "string" ||
          !roleList(value.roles) || !roleList(value.workspaceRoles) || !time(value.capturedAt) ||
          typeof value.expiresAt !== "string" || value.expiresAt && !time(value.expiresAt) ||
          !Array.isArray(value.areas) || value.areas.length !== areaIds.length ||
          value.areas.some(area => !areaIds.includes(area.id) || !roleList(area.roles)) || new Set(value.areas.map(area => area.id)).size !== areaIds.length) {
        throw new ApiError(200, "некорректно_ответ", "");
      }
      if (!combined) combined = { ...value, areas: [...value.areas] };
      else {
        if (value.owner !== combined.owner || JSON.stringify([...value.workspaceRoles].sort()) !== JSON.stringify([...combined.workspaceRoles].sort()) ||
            JSON.stringify([...value.roles].sort()) !== JSON.stringify([...combined.roles].sort())) throw new ApiError(409, "страница_контекст_изменено", "");
        combined.areas.push(...value.areas);
        if (value.expiresAt && (!combined.expiresAt || value.expiresAt < combined.expiresAt)) combined.expiresAt = value.expiresAt;
      }
    }
    return combined;
  }

  function scheduleAuthorityExpiry() {
    clearTimeout(authorityTimer); authorityTimer = null;
    if (!state.authority?.expiresAt) return;
    const expiry = Date.parse(state.authority.expiresAt.endsWith("Z") ? state.authority.expiresAt : state.authority.expiresAt + "Z");
    if (!Number.isFinite(expiry)) return;
    authorityTimer = setTimeout(() => {
      if (Date.now() < expiry) { scheduleAuthorityExpiry(); return; }
      invalidateHostContext(); clearPackageContext("orders"); clearPackageContext("hydrology");
      setBusy(false);
      if (state.me) { render(); showNotice("Срок назначений изменился. Частные данные скрыты; обновите кабинет для актуального доступа."); }
    }, Math.min(2147483647, Math.max(1, expiry - Date.now() + 1)));
  }

  function noNativeSession(error) {
    return (error.status === 400 || error.status === 404) && error.code === "хттп_ошибка";
  }

  function duration(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "Не указан";
    if (seconds >= 3600) return Math.floor(seconds / 3600) + " ч " + Math.floor((seconds % 3600) / 60) + " мин";
    return Math.max(1, Math.ceil(seconds / 60)) + " мин";
  }

  function expiration(value) {
    if (!value || /^0*1-01-01/.test(value)) return "Без ограничения срока";
    const date = new Date(value.endsWith("Z") ? value : value + "Z");
    return Number.isNaN(date.valueOf()) ? "Срок задан сервером" : "До " + date.toLocaleString("ru-RU");
  }

  function clearSession(message = "Войдите под своей учётной записью портала.") {
    invalidateHostContext();
    entryRouteApplied = false;
    if ($("service-entry-notice")) { $("service-entry-notice").hidden = true; $("service-entry-notice").textContent = ""; }
    sequence += 1;
    state = emptyState();
    lab?.reset();
    labStaff?.reset();
    clearTimeout(inventoryLeaseTimer);
    inventoryLeaseTimer = null;
    inventoryAccessRejected = false;
    inventory?.reset();
    hideInventory();
    clearTimeout(workMaterialsLeaseTimer);
    workMaterialsLeaseTimer = null;
    workMaterialsAccessRejected = false;
    workMaterials?.reset();
    hideWorkMaterials();
    clearTimeout(workOrdersLeaseTimer);
    clearTimeout(hydrologyLeaseTimer);
    workOrdersAccessRejected = false;
    hydrologyAccessRejected = false;
    workOrders?.reset();
    hydrology?.reset();
    hidePackageSection("orders");
    hidePackageSection("hydrology");
    $("lab-staff").hidden = true;
    $("lab-staff-nav").hidden = true;
    actionButtons = [];
    sessionButtons = [];
    pendingCreations = { area: null, invitation: null, customerLink: null };
    resetCustomer();
    resetMeterAll();
    resetWater();
    resetDispatch();
    w.area.replaceChildren();
    resetRegistry();
    ui.registryArea.replaceChildren();
    ui.registrySearch.value = "";
    ui.registryFilterState.value = "";
    ui.password.value = "";
    ui.username.value = "";
    ui.workspaceName.value = "";
    ui.workspaceSelect.replaceChildren();
    ui.membershipsBody.replaceChildren();
    ui.sessionsBody.replaceChildren();
    $("sessions-container").hidden = true;
    $("sessions-empty").hidden = false;
    $("sessions-empty").textContent = "Список еще не загружен.";
    $("session-count").textContent = "0";
    ["areas-list", "incoming-list", "outgoing-list"].forEach((id) => { $(id).replaceChildren(); });
    [ui.roleTarget, ui.roleArea, ui.invitationArea].forEach((control) => { control.replaceChildren(); });
    [ui.areaName, ui.invitationRecipient, ui.currentPassword, ui.newPassword, ui.confirmPassword]
      .forEach((control) => { control.value = ""; });
    ui.roleScope.value = "All";
    ui.invitationScope.value = "All";
    ui.invitationTTL.value = "86400";
    ui.roleSelect.selectedIndex = 0;
    ui.invitationRole.selectedIndex = 0;
    ["profile-heading", "identity-name", "actor-id", "account-id", "session-summary", "idle-timeout", "workspace-state", "workspace-ownership", "workspace-profile", "membership-visibility"].forEach((id) => { $(id).textContent = ""; });
    $("profile-avatar").textContent = "В";
    $("role-count").textContent = "0";
    ["area-count", "incoming-count", "outgoing-count"].forEach((id) => { $(id).textContent = "0"; });
    $("workspace-details").hidden = true;
    $("memberships-container").hidden = true;
    $("memberships-empty").hidden = true;
    ui.app.hidden = true;
    ui.login.hidden = false;
    ui.loginStatus.textContent = message;
    setBusy(false);
  }

  function handleError(error, loginAttempt = false) {
    if (["контекст_изменено", "счетчик_контекст_изменено"].includes(error?.code)) return;
    const message = errorMessage(error, loginAttempt);
    if (!loginAttempt && state.me && (error.status === 401 || noNativeSession(error))) {
      clearSession(message);
      ui.username.focus();
    }
    showNotice(message, true);
  }

  function appendCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (className) cell.className = className;
    row.append(cell);
    return cell;
  }

  function selectOptions(select, entries, preferred = "") {
    const previous = preferred || select.value;
    select.replaceChildren();
    for (const [value, label] of entries) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    if (entries.some(([value]) => value === previous)) select.value = previous;
  }

  function areaLabel(areaId) {
    return state.areas.find((area) => area.id === areaId)?.name || areaId;
  }

  function scopeLabel(item) {
    return item.areaScope === "All" ? "Все пространство" : "Область: " + areaLabel(item.areaId);
  }

  function activeTargets() {
    const accounts = new Set(state.me ? [state.me.accountId] : []);
    for (const row of state.memberships) {
      if (currentMembership(row) && (row.areaScope === "All" || state.areas.some((area) => area.id === row.areaId && area.state === "Active"))) {
        accounts.add(row.accountId);
      }
    }
    return accounts;
  }

  function actionButton(label, callback, danger = false, collection = actionButtons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button " + (danger ? "danger" : "secondary");
    button.textContent = label;
    button.addEventListener("click", callback);
    collection.push(button);
    return button;
  }

  async function mutate(operation, message) {
    if (busy || !state.me) return;
    const workspaceId = state.workspaceId;
    clearNotice();
    setBusy(true);
    let confirmed = false;
    try {
      await operation();
      confirmed = true;
      await loadDashboard(workspaceId);
      showNotice(message);
    } catch (error) {
      handleError(error);
      if (confirmed) showNotice("Изменение подтверждено сервером, но данные не обновлены. " + errorMessage(error), true);
    }
    finally { setBusy(false); }
  }

  function renderAreas() {
    const list = $("areas-list");
    list.replaceChildren();
    for (const area of state.areas) {
      const record = document.createElement("div");
      record.className = "record";
      const title = document.createElement("div");
      title.className = "record-title";
      title.textContent = area.name;
      const meta = document.createElement("div");
      meta.className = "record-meta mono";
      meta.textContent = area.id + " · версия " + area.revision;
      record.append(title, meta);
      list.append(record);
    }
    $("area-count").textContent = String(state.areas.length);
    $("areas-empty").hidden = state.areas.length !== 0;
    $("area-owner-note").textContent = isOwner() ? "Область создается в выбранном пространстве." : "Создавать области может только владелец пространства.";
    const areas = state.areas.filter((area) => area.state === "Active").map((area) => [area.id, area.name]);
    selectOptions(ui.roleArea, areas);
    selectOptions(ui.invitationArea, areas);
    selectOptions(ui.roleTarget, [...activeTargets()].map((id) => [id, id === state.me.accountId ? "Вы · " + id : id]));
    updateScopeFields();
  }

  function renderInvitations() {
    const stateNames = { Pending: "Ожидает решения", Accepted: "Принято", Declined: "Отклонено", Revoked: "Отозвано", Expired: "Срок истек" };
    for (const [direction, items] of [["incoming", state.incoming], ["outgoing", state.outgoing]]) {
      const list = $(direction + "-list");
      list.replaceChildren();
      for (const invitation of items) {
        const record = document.createElement("div");
        record.className = "record";
        const title = document.createElement("div");
        title.className = "record-title";
        title.textContent = roles.get(invitation.role) || invitation.role;
        const status = document.createElement("div");
        status.className = "record-status";
        status.textContent = (stateNames[invitation.state] || invitation.state) + " · версия " + invitation.revision;
        const meta = document.createElement("div");
        meta.className = "record-meta";
        const workspace = state.workspaces.find((item) => item.id === invitation.workspaceId);
        for (const text of [
          "Пространство: " + (workspace?.name || invitation.workspaceId),
          (direction === "incoming" ? "От: " + invitation.inviterAccountId : "Получатель: " + invitation.recipientAccountId),
          scopeLabel(invitation), expiration(invitation.expiresAt)
        ]) {
          const line = document.createElement("div");
          line.textContent = text;
          meta.append(line);
        }
        record.append(title, status, meta);
        const actions = document.createElement("div");
        actions.className = "record-actions";
        if (direction === "incoming" && invitation.recipientAccountId === state.me.accountId && invitation.state === "Pending") {
          actions.append(actionButton("Принять", () => invitationAction(invitation.id, "accept")),
            actionButton("Отклонить", () => invitationAction(invitation.id, "decline"), true));
        }
        if (direction === "outgoing" && isOwner() && invitation.inviterAccountId === state.me.accountId &&
            (invitation.state === "Pending" || invitation.state === "Accepted")) {
          actions.append(actionButton(invitation.state === "Accepted" ? "Отозвать приглашенный доступ" : "Отозвать", () => invitationAction(invitation.id, "revoke"), true));
        }
        if (actions.children.length) record.append(actions);
        list.append(record);
      }
      $(direction + "-count").textContent = String(items.length);
      $(direction + "-empty").hidden = items.length !== 0 || (direction === "outgoing" && !isOwner());
    }
    $("outgoing-owner-note").hidden = isOwner();
  }

  function sessionTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return "Формат даты не распознан";
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + "Z";
    const date = new Date(normalized);
    return Number.isNaN(date.valueOf()) ? "Формат даты не распознан" : date.toLocaleString("ru-RU");
  }

  function renderSessions() {
    sessionButtons = [];
    ui.sessionsBody.replaceChildren();
    const names = { active: "Действует", expired: "Срок истек", revoked: "Отозван" };
    for (const session of state.sessions) {
      const row = document.createElement("tr");
      const idCell = appendCell(row, session.id, "mono");
      if (session.current) {
        const current = document.createElement("span");
        current.className = "current-session-tag";
        current.textContent = "Текущий";
        idCell.append(current);
      }
      for (const field of ["createdAt", "lastSeenAt", "idleExpiresAt", "absoluteExpiresAt"]) {
        appendCell(row, sessionTimestamp(session[field]));
      }
      appendCell(row, names[session.state], "session-state-" + session.state);
      const actions = appendCell(row, "—");
      if (session.state !== "revoked") {
        actions.textContent = "";
        const button = actionButton(session.current ? "Завершить текущий" : "Отозвать", () => revokeOwnSession(session.id), true, sessionButtons);
        button.className += " table-action";
        button.setAttribute("aria-label", (session.current ? "Завершить текущий сеанс " : "Отозвать свой сеанс ") + session.id);
        actions.append(button);
      }
      ui.sessionsBody.append(row);
    }
    $("session-count").textContent = String(state.sessions.length);
    $("sessions-container").hidden = state.sessions.length === 0;
    $("sessions-empty").hidden = state.sessions.length !== 0;
    $("sessions-empty").textContent = state.sessionsLoaded ? "Сервер не вернул сеансов." : "Список еще не загружен.";
  }

  async function readOwnSessions(more = false) {
    const sessions = await requestList("account/sessions", more);
    if (!Array.isArray(sessions) || sessions.some((session) =>
      typeof session.id !== "string" || typeof session.current !== "boolean" || !["active", "expired", "revoked"].includes(session.state))) {
      throw new ApiError(200, "некорректно_ответ", "");
    }
    state.sessions = sessions;
    state.sessionsLoaded = true;
    renderSessions();
    listContinuation("sessions-container", "account/sessions", () => readOwnSessions(true), "Загрузить ещё сеансы", sessions);
  }

  async function revokeOwnSession(id) {
    const session = state.sessions.find((item) => item.id === id);
    if (busy || !state.me || !session || session.state === "revoked") return;
    clearNotice();
    setBusy(true);
    try {
      const result = await request("account/sessions/" + encodeURIComponent(id) + "/actions/revoke", { method: "POST", body: {} });
      if (result.id !== id || result.revoked !== true || typeof result.current !== "boolean") throw new ApiError(200, "некорректно_ответ", "");
      if (result.current || session.current) {
        clearSession("Текущий сеанс завершен. Войдите заново.");
        showNotice("Текущий сеанс отозван. Данные кабинета очищены.");
        ui.username.focus();
      } else {
        await readOwnSessions();
        showNotice("Выбранный сеанс отозван. Текущий кабинет остается открыт.");
      }
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  function registryAreaAllowed(areaId) {
    return !!(state.me && state.areas.some((area) => area.id === areaId && area.workspaceId === state.workspaceId && area.state === "Active") &&
      roleMemberships().some((member) => member.accountId === state.me.accountId && member.workspaceId === state.workspaceId &&
        member.role === "BillingSpecialist" && currentMembership(member) &&
        ((member.areaScope === "All" && !member.areaId) || (member.areaScope === "Area" && member.areaId === areaId))));
  }

  function registryContextReady() {
    return registry.loaded && registry.workspaceId === state.workspaceId && registry.areaId === ui.registryArea.value &&
      registry.kind === ui.registryEntity.value && registryAreaAllowed(registry.areaId);
  }

  function resetRegistry() {
    $("registry").querySelectorAll(".portal-page-controls").forEach(node => node.remove());
    registry = emptyRegistry();
    registryInputs = new Map();
    registryButtons = [];
    ui.registryList.replaceChildren();
    ui.registryDetail.replaceChildren();
    ui.registryFields.replaceChildren();
    resetRegistryLifecycle();
    $("registry-empty").hidden = false;
    $("registry-empty").textContent = "Выберите область и загрузите список.";
    $("registry-detail-empty").hidden = false;
  }

  function registryFields() {
    return [
      { name: "name", label: "Наименование", max: 150 },
      { name: "state", label: "Состояние создаваемой записи", kind: "choice", choices: [["Active", "Действующая"], ["Closed", "Архивная при создании"]] },
      ...(registrySchemas.get(ui.registryEntity.value)?.fields || [])
    ];
  }

  function renderRegistryAccess() {
    const permitted = state.areas.filter((area) => registryAreaAllowed(area.id));
    const previousArea = ui.registryArea.value;
    selectOptions(ui.registryArea, permitted.map((area) => [area.id, area.name]));
    if (registry.workspaceId && (registry.workspaceId !== state.workspaceId || registry.areaId !== ui.registryArea.value || !registryAreaAllowed(registry.areaId))) resetRegistry();
    $("registry-access-note").textContent = permitted.length
      ? "Выберите участок для работы с реестром."
      : "Нет доступа к реестру. Обратитесь к владельцу рабочей области.";
    if (!registryInputs.size || previousArea !== ui.registryArea.value) buildRegistryForm();
    const schema = registrySchemas.get(ui.registryEntity.value);
    ui.registrySearch.placeholder = schema?.search || "Точное совпадение";
  }

  function buildRegistryForm() {
    registryInputs = new Map();
    ui.registryFields.replaceChildren();
    for (const field of registryFields()) {
      const wrapper = document.createElement("div");
      wrapper.className = "field";
      const label = document.createElement("label");
      label.textContent = field.label;
      const id = "registry-field-" + field.name;
      label.setAttribute("for", id);
      const input = document.createElement(field.kind === "choice" || field.kind === "ref" ? "select" : "input");
      input.id = id;
      input.setAttribute("name", field.name);
      input.registryLocked = !!field.locked;
      input.required = !field.optional;
      if (field.max) input.maxLength = field.max;
      if (field.kind === "choice") selectOptions(input, field.choices);
      else if (field.kind === "date") { input.type = "datetime-local"; input.step = "1"; }
      else if (field.kind !== "ref") input.type = "text";
      input.addEventListener("change", () => { if (registryContextReady()) { refreshRegistryReferences(); setBusy(busy); } });
      registryInputs.set(field.name, input);
      wrapper.append(label, input);
      if (field.kind === "numberCode" || field.kind === "date") {
        const help = document.createElement("p");
        help.className = "field-help";
        help.textContent = field.kind === "numberCode" ? "Латинские буквы, цифры и - / _. Начальные нули сохраняются."
          : "Укажите местное время.";
        wrapper.append(help);
      }
      ui.registryFields.append(wrapper);
    }
    if (registry.loaded) refreshRegistryReferences();
  }

  function registryReference(resource, id) {
    return (registry.references[resource] || []).find((row) => row.id === id);
  }

  function registryReferenceAllowed(resource, row, createState, visited = new Set()) {
    if (!row || row.workspaceId !== state.workspaceId || row.areaId !== registry.areaId ||
        !["Active", "Closed"].includes(row.state) || (createState === "Active" && row.state !== "Active")) return false;
    const key = resource + ":" + row.id;
    if (visited.has(key)) return false;
    const next = new Set(visited).add(key);
    const allowed = (kind, id) => registryReferenceAllowed(kind, registryReference(kind, id), createState, next);
    if (resource === "subscribers") return true;
    if (resource === "properties") return allowed("subscribers", row.ownerSubscriberId);
    if (resource === "service-points") return allowed("properties", row.propertyId);
    if (resource === "contracts") {
      const property = registryReference("properties", row.propertyId);
      const point = registryReference("service-points", row.servicePointId);
      return allowed("subscribers", row.subscriberId) && allowed("properties", row.propertyId) && allowed("service-points", row.servicePointId) &&
        property.ownerSubscriberId === row.subscriberId && point.propertyId === row.propertyId && point.serviceKind === row.serviceKind;
    }
    return false;
  }

  function refreshRegistryReferences() {
    const schema = registrySchemas.get(ui.registryEntity.value);
    if (!schema) return;
    const createState = registryInputs.get("state")?.value || "Active";
    for (const field of schema.fields.filter((item) => item.kind === "ref")) {
      let candidates = (registry.references[field.resource] || []).filter((row) => registryReferenceAllowed(field.resource, row, createState));
      if (ui.registryEntity.value === "contracts" && field.name === "propertyId") {
        candidates = candidates.filter((row) => row.ownerSubscriberId === registryInputs.get("subscriberId").value);
      }
      if (ui.registryEntity.value === "contracts" && field.name === "servicePointId") {
        candidates = candidates.filter((row) => row.propertyId === registryInputs.get("propertyId").value && row.serviceKind === registryInputs.get("serviceKind").value);
      }
      if (ui.registryEntity.value === "personal-accounts" && field.locked) {
        const contract = registryReference("contracts", registryInputs.get("contractId").value);
        candidates = candidates.filter((row) => row.id === contract?.[field.name]);
      }
      const entries = candidates.map((row) => [row.id, (row.numberNormalized ? row.numberNormalized + " · " : "") + row.name + (row.state === "Closed" ? " · архив" : "")]);
      if (!entries.length) entries.push(["", "Нет подходящих записей в загруженной выборке"]);
      selectOptions(registryInputs.get(field.name), entries);
    }
    renderRegistryReferencePages();
  }

  function renderRegistryReferencePages() {
    $("registry-reference-pages")?.remove();
    const schema = registrySchemas.get(registry.kind);
    if (!registry.loaded || !schema?.dependencies.length) return;
    const box = document.createElement("div"); box.id = "registry-reference-pages"; box.className = "full-field";
    const title = document.createElement("h3"); title.textContent = "Связанные справочники"; box.append(title); ui.registryFields.append(box);
    for (const resource of schema.dependencies) {
      const path = resource + "?" + registryQuery(), anchor = document.createElement("p"); anchor.id = "registry-reference-" + resource;
      anchor.textContent = registrySchemas.get(resource)?.title || resource; box.append(anchor);
      listContinuation(anchor, path, async () => {
        if (!registryContextReady()) throw new ApiError(409, "страница_контекст_изменено", "");
        registry.references[resource] = checkedRegistryRows(await requestList(path, true), registry.workspaceId, registry.areaId);
        refreshRegistryReferences();
      }, "Загрузить ещё: " + anchor.textContent, registry.references[resource]);
    }
  }

  function registryQuery(filters = false) {
    let query = "workspaceId=" + encodeURIComponent(state.workspaceId) + "&areaId=" + encodeURIComponent(ui.registryArea.value);
    if (filters && ui.registryFilterState.value) query += "&state=" + encodeURIComponent(ui.registryFilterState.value);
    if (filters && ui.registrySearch.value.trim()) query += "&search=" + encodeURIComponent(ui.registrySearch.value.trim());
    return query;
  }

  function checkedRegistryRows(rows, workspaceId, areaId) {
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.id !== "string" || typeof row.name !== "string" ||
      row.workspaceId !== workspaceId || row.areaId !== areaId || !["Active", "Closed"].includes(row.state))) throw new ApiError(200, "некорректно_ответ", "");
    return rows;
  }

  function renderRegistryRows() {
    registryButtons = [];
    ui.registryList.replaceChildren();
    const schema = registrySchemas.get(registry.kind);
    $("registry-list-heading").textContent = schema.title + " · " + registry.rows.length + " в выборке";
    for (const item of registry.rows) {
      const record = document.createElement("div");
      record.className = "record";
      const title = document.createElement("div");
      title.className = "record-title";
      title.textContent = item.name;
      const meta = document.createElement("div");
      meta.className = "record-meta";
      meta.textContent = (item.numberNormalized ? "№ " + item.numberNormalized + " · " : "") + (item.state === "Active" ? "Действует" : "Архив") + " · " + item.id;
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(actionButton("Открыть карточку", () => openRegistryDetail(item.id), false, registryButtons));
      record.append(title, meta, actions);
      ui.registryList.append(record);
    }
    $("registry-empty").hidden = registry.rows.length !== 0;
    $("registry-empty").textContent = "По выбранным фильтрам записей нет. Введите полное значение для поиска.";
  }

  async function readRegistry(more = false) {
    const kind = ui.registryEntity.value;
    const schema = registrySchemas.get(kind);
    const workspaceId = state.workspaceId;
    const areaId = ui.registryArea.value;
    const filters = { state: ui.registryFilterState.value, search: ui.registrySearch.value.trim() };
    if (!schema || !registryAreaAllowed(areaId)) throw new ApiError(403, "кабинет_область_запрещено", "");
    const path = kind + "?" + registryQuery(true);
    if (more) {
      if (!registryContextReady() || registry.filters.state !== filters.state || registry.filters.search !== filters.search) throw new ApiError(409, "страница_контекст_изменено", "");
      registry.rows = checkedRegistryRows(await requestList(path, true), workspaceId, areaId);
      renderRegistryRows(); listContinuation(ui.registryList, path, () => readRegistry(true), "Загрузить ещё", registry.rows); return;
    }
    const resources = [kind, ...schema.dependencies];
    const lists = await Promise.all(resources.map((resource, index) => requestList(resource + "?" + registryQuery(index === 0))));
    lists.forEach((rows) => checkedRegistryRows(rows, workspaceId, areaId));
    registry = { workspaceId, areaId, kind, rows: lists[0], references: Object.fromEntries(resources.slice(1).map((resource, index) => [resource, lists[index + 1]])), detail: null, loaded: true, uncertain: false, lifecycleStale: false, filters };
    renderRegistryRows();
    listContinuation(ui.registryList, path, () => readRegistry(true), "Загрузить ещё", registry.rows);
    ui.registryDetail.replaceChildren();
    resetRegistryLifecycle();
    $("registry-detail-empty").hidden = false;
    buildRegistryForm();
    $("registry-create-note").textContent = "Для изменения существующей записи откройте её карточку.";
  }

  function renderRegistryDetail(item) {
    resetRegistryLifecycle();
    registry.detail = item;
    registry.lifecycleStale = false;
    ui.registryDetail.replaceChildren();
    const fields = [
      ["id", "ID"], ["name", "Наименование"], ["state", "Состояние"],
      ...registrySchemas.get(registry.kind).fields.map((field) => [field.name === "number" ? "numberNormalized" : field.name, field.label]),
      ["workspaceId", "Пространство"], ["areaId", "Область"], ["createdBy", "Создал"],
      ["createdAt", "Создано"], ["updatedAt", "Обновлено"], ["revision", "Версия записи"]
    ];
    for (const [key, label] of fields) {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = label;
      const choice = registrySchemas.get(registry.kind).fields.find((field) => field.name === key)?.choices?.find(([code]) => code === item[key]);
      if (key === "state") value.textContent = item[key] === "Active" ? "Действует" : "Архив";
      else if (choice) value.textContent = choice[1];
      else if (key === "validTo" && (!item[key] || /^0*1-01-01/.test(item[key]))) value.textContent = "Без окончания";
      else if (["createdAt", "updatedAt", "validFrom", "validTo"].includes(key)) value.textContent = sessionTimestamp(item[key]);
      else value.textContent = item[key] === undefined || item[key] === "" ? "Не указано" : String(item[key]);
      group.append(term, value);
      ui.registryDetail.append(group);
    }
    $("registry-detail-empty").hidden = true;
    renderRegistryLifecycle();
    if (registry.kind === "properties") renderPropertyServiceHistoryPanel();
  }

  const lifecycleActions = new Map([
    ["subscribers", { action: "update-contacts", label: "Сохранить контакты", operation: "subscriber.contacts", fields: ["name", "phone", "email"] }],
    ["properties", { action: "update-details", label: "Сохранить сведения объекта", operation: "property.details", fields: ["name", "address", "propertyType"] }],
    ["personal-accounts", { action: "close", label: "Закрыть лицевой счет", operation: "personal-account.close", fields: [] }],
    ["contracts", { action: "terminate", label: "Прекратить договор", operation: "contract.terminate", fields: [] }]
  ]);

  function registryLifecycleReady() {
    return !!(registryContextReady() && registry.detail && lifecycleActions.has(registry.kind) &&
      validPublicId(registry.detail.id) && Number.isSafeInteger(registry.detail.revision) && registry.detail.revision >= 1 && registry.detail.revision <= 999999999999998);
  }

  function registryLifecycleEditable() {
    return registryLifecycleReady() && registry.detail.state === "Active" && registry.detail.revision <= 999999999999997 && !registry.lifecycleStale;
  }

  function resetRegistryLifecycle() {
    propertyServiceHistory = null;
    $("property-service-history")?.remove();
    pendingCreations.registryLifecycle = null;
    lifecycleInputs = new Map();
    ui.lifecycleFields.replaceChildren();
    ui.lifecycleReason.value = "";
    ui.lifecycleForm.hidden = true;
    $("registry-lifecycle-note").textContent = "";
    ui.registryHistory.replaceChildren();
    $("registry-history-empty").hidden = false;
    $("registry-history-empty").textContent = "История еще не загружена.";
  }

  function renderRegistryLifecycle() {
    const action = lifecycleActions.get(registry.kind);
    const item = registry.detail;
    if (!action || !registryLifecycleReady()) return;
    ui.lifecycleForm.hidden = !registryLifecycleEditable();
    if (!registryLifecycleEditable()) return;
    const descriptors = [{ name: "name", label: "Наименование", max: 150 }, ...registrySchemas.get(registry.kind).fields];
    for (const name of action.fields) {
      const field = descriptors.find((entry) => entry.name === name);
      const wrapper = document.createElement("div");
      wrapper.className = "field";
      const label = document.createElement("label");
      const input = document.createElement(field.kind === "choice" ? "select" : "input");
      input.id = "registry-lifecycle-" + name;
      input.setAttribute("name", "lifecycle-" + name);
      label.setAttribute("for", input.id);
      label.textContent = field.label;
      input.required = !field.optional;
      if (field.max) input.maxLength = field.max;
      if (field.kind === "choice") selectOptions(input, field.choices, item[name]);
      else { input.type = "text"; input.value = typeof item[name] === "string" ? item[name] : ""; }
      lifecycleInputs.set(name, input);
      wrapper.append(label, input);
      ui.lifecycleFields.append(wrapper);
    }
    ui.lifecycleButton.textContent = action.label;
    ui.lifecycleButton.classList.toggle("danger", action.fields.length === 0);
    $("registry-lifecycle-note").textContent = "Версия записи открытой карточки: " + item.revision + ". Основание обязательно. " +
      (registry.kind === "personal-accounts" ? "Закрытый ЛС остается в архиве; история сохраняется, новые показания и коррекции запрещены. Номер остается зарезервированным. " :
        registry.kind === "contracts" ? "Договор можно прекратить только после закрытия всех связанных действующих ЛС. " : "Владельцы, связи, тип абонента и номера не изменяются. ") +
      "Если карточка изменилась, откройте её заново.";
  }

  function lifecycleText(value, max, optional = false, ascii = false) {
    if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ud800-\udfff]/.test(value) ||
      (!optional && !value.trim()) || (ascii && /[^\x20-\x7e]/.test(value))) throw new ApiError(400, "кабинет_жизненный_цикл_некорректно_поле", "");
    return value.trim();
  }

  function registryLifecyclePayload() {
    if (!registryLifecycleEditable()) throw new ApiError(409, "кабинет_жизненный_цикл_состояние_конфликт", "");
    const payload = { workspaceId: registry.workspaceId, areaId: registry.areaId, expectedRevision: registry.detail.revision, reason: lifecycleText(ui.lifecycleReason.value, 250) };
    for (const name of lifecycleActions.get(registry.kind).fields) {
      const contact = name === "phone" || name === "email";
      const max = name === "name" ? 150 : name === "phone" ? 32 : name === "email" ? 128 : name === "address" ? 250 : 32;
      let value = lifecycleText(lifecycleInputs.get(name)?.value, max, contact, contact);
      if (name === "email") value = value.toLowerCase();
      if (name === "propertyType" && !["Residential", "Commercial", "Industrial", "Other"].includes(value)) throw new ApiError(400, "кабинет_жизненный_цикл_некорректно_поле", "");
      payload[name] = value;
    }
    return payload;
  }

  function historySnapshot(item, resource = registry.kind) {
    const list = document.createElement("dl");
    list.className = "registry-detail-list";
    const fields = [["id", "ID"], ["name", "Наименование"], ["state", "Состояние"],
      ...registrySchemas.get(resource).fields.map((field) => [field.name === "number" ? "numberNormalized" : field.name, field.label]),
      ["workspaceId", "Пространство"], ["areaId", "Область"], ["createdBy", "Создал"], ["createdAt", "Создано"], ["updatedAt", "Обновлено"], ["revision", "Версия записи"]];
    for (const [key, title] of fields) {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = title;
      const scalar = item[key];
      value.textContent = key === "state" ? (scalar === "Active" ? "Действует" : "Архив") :
        ["createdAt", "updatedAt", "validFrom", "validTo"].includes(key) ? (key === "validTo" && /^0*1-01-01/.test(scalar) ? "Без окончания" : sessionTimestamp(scalar)) :
        typeof scalar === "string" || typeof scalar === "number" ? String(scalar || (scalar === 0 ? 0 : "Не указано")) : "Не указано";
      group.append(term, value);
      list.append(group);
    }
    return list;
  }

  const serviceHistoryOperations = new Map([
    ["property.create", ["properties", "Объект и первоначальный владелец записаны"]],
    ["property.details", ["properties", "Сведения об объекте изменены"]],
    ["service-point.create", ["service-points", "Точка обслуживания создана"]],
    ["contract.create", ["contracts", "Договор обслуживания создан"]],
    ["contract.terminate", ["contracts", "Договор обслуживания прекращён"]]
  ]);

  function renderPropertyServiceHistoryPanel() {
    const panel = document.createElement("section"); panel.id = "property-service-history";
    const heading = document.createElement("h3"); heading.textContent = "Владелец и обслуживание объекта";
    const note = document.createElement("p"); note.className = "muted small";
    note.textContent = "Отдельная история записанных событий. Текущие связи не восстанавливают отсутствующие прошлые записи.";
    const body = document.createElement("div"); body.id = "property-service-history-body";
    panel.append(heading, note, actionButton("Загрузить историю владельца и обслуживания", () => readPropertyServiceHistory(), false, registryButtons), body);
    ui.registryDetail.after(panel);
  }

  function validServiceHistorySnapshot(item, resource, propertyId, workspaceId, areaId) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !registrySchemas.has(resource)) return false;
    const fields = ["id", "workspaceId", "areaId", "name", "state", "createdBy", "createdAt", "updatedAt", "revision",
      ...registrySchemas.get(resource).fields.map(field => field.name === "number" ? "numberNormalized" : field.name)];
    if (Object.keys(item).length !== fields.length || fields.some(key => !Object.hasOwn(item, key)) ||
        Object.entries(item).some(([key, value]) => key !== "revision" && (typeof value !== "string" || value.length > 250)) ||
        !validPublicId(item.id) || !validPublicId(item.createdBy) || item.workspaceId !== workspaceId || item.areaId !== areaId ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 || !["Active", "Closed"].includes(item.state)) return false;
    if (resource === "properties") return item.id === propertyId && validPublicId(item.ownerSubscriberId) && ["Residential", "Commercial", "Industrial", "Other"].includes(item.propertyType);
    if (item.propertyId !== propertyId || !["WaterSupply", "Wastewater"].includes(item.serviceKind)) return false;
    return resource === "service-points" || resource === "contracts" && validPublicId(item.subscriberId) && validPublicId(item.servicePointId);
  }

  async function readPropertyServiceHistory(more = false) {
    if (busy || registry.kind !== "properties" || !registryLifecycleReady()) return;
    const propertyId = registry.detail.id, workspaceId = registry.workspaceId, areaId = registry.areaId, epoch = hostEpoch;
    const path = "registry-history/properties/" + encodeURIComponent(propertyId) + "?" + registryQuery() + "&view=service";
    const previous = propertyServiceHistory;
    if (more && (!previous || previous.path !== path || !previous.hasMore)) return;
    clearNotice(); setBusy(true);
    try {
      const data = await request(path + "&limit=25" + (more ? "&cursor=" + encodeURIComponent(previous.nextCursor) : ""));
      if (epoch !== hostEpoch || registry.detail?.id !== propertyId || registry.workspaceId !== workspaceId || registry.areaId !== areaId) throw new ApiError(0, "контекст_изменено", "");
      const utc = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value;
      const coverage = data?.coverage;
      if (!data || data.view !== "service" || data.propertyId !== propertyId || data.limit !== 25 || !Array.isArray(data.items) || data.items.length > 25 ||
          typeof data.hasMore !== "boolean" || typeof data.nextCursor !== "string" || data.nextCursor.length > 256 ||
          data.hasMore && (data.items.length !== 25 || !data.nextCursor || more && data.nextCursor === previous.nextCursor) || !data.hasMore && data.nextCursor !== "" ||
          !coverage || Object.keys(coverage).sort().join(",") !== "capturedFrom,initialOwnerRecorded,legacyBoundary,policy" ||
          typeof coverage.initialOwnerRecorded !== "boolean" || coverage.legacyBoundary !== !coverage.initialOwnerRecorded || coverage.policy !== "recorded-events-only" ||
          coverage.capturedFrom !== "" && !utc(coverage.capturedFrom) || coverage.initialOwnerRecorded && !coverage.capturedFrom ||
          more && Object.keys(coverage).some(key => coverage[key] !== previous.coverage[key])) throw new ApiError(200, "некорректно_ответ", "");
      let last = more ? previous.items.at(-1).sequence : Number.MAX_SAFE_INTEGER;
      for (const event of data.items) {
        const kind = serviceHistoryOperations.get(event?.operation), creation = event?.operation?.endsWith(".create");
        if (!kind || Object.keys(event).sort().join(",") !== "actorAccountId,after,before,changedAt,entityId,operation,reason,resource,sequence,sourceRevision" ||
            event.resource !== kind[0] || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence >= last ||
            !validPublicId(event.actorAccountId) || !utc(event.changedAt) || typeof event.reason !== "string" || event.reason.length > 250 ||
            !validServiceHistorySnapshot(event.after, event.resource, propertyId, workspaceId, areaId) || event.entityId !== event.after.id ||
            event.sourceRevision !== event.after.revision || event.after.updatedAt !== event.changedAt ||
            creation && (event.before !== null || event.sourceRevision !== 1 || event.after.createdBy !== event.actorAccountId || event.after.createdAt !== event.changedAt) ||
            !creation && (!validServiceHistorySnapshot(event.before, event.resource, propertyId, workspaceId, areaId) || event.before.id !== event.entityId || event.before.revision + 1 !== event.sourceRevision) ||
            event.operation === "property.create" && event.sequence !== 1) throw new ApiError(200, "некорректно_ответ", "");
        last = event.sequence;
      }
      const items = more ? [...previous.items, ...data.items] : data.items;
      propertyServiceHistory = { path, items, coverage, hasMore: data.hasMore, nextCursor: data.nextCursor };
      const body = $("property-service-history-body"); body.replaceChildren();
      const boundary = document.createElement("p"); boundary.className = "muted";
      boundary.textContent = coverage.initialOwnerRecorded ? "Запись начинается с создания объекта: " + sessionTimestamp(coverage.capturedFrom) + "." :
        "Начальная история владельца и обслуживания не была записана. " + (coverage.capturedFrom ? "Сохранённые события доступны с " + sessionTimestamp(coverage.capturedFrom) + "." : "Сохранённых событий пока нет.");
      body.append(boundary);
      for (const event of items) {
        const record = customerRecord(serviceHistoryOperations.get(event.operation)[1], [
          "Событие № " + event.sequence + " · " + sessionTimestamp(event.changedAt), "Учетная запись: " + event.actorAccountId,
          "Источник: " + event.entityId + " · редакция " + event.sourceRevision, event.reason ? "Основание: " + event.reason : "Первичная записанная версия"
        ]);
        for (const [label, snapshot] of [["До", event.before], ["После", event.after]]) {
          if (snapshot === null) continue;
          const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = label;
          details.append(summary, historySnapshot(snapshot, event.resource)); record.append(details);
        }
        body.append(record);
      }
      const count = document.createElement("p"); count.className = "muted small";
      count.textContent = "Загружено событий: " + items.length + ". " + (data.hasMore ? "Есть предыдущие события." : "Продолжения на момент чтения нет. Это не подтверждает полноту незаписанного прошлого.");
      body.append(count);
      if (data.hasMore) body.append(actionButton("Загрузить предыдущие события обслуживания", () => readPropertyServiceHistory(true), false, registryButtons));
    } catch (error) {
      if (error.status === 403 || error.status === 404) resetRegistry();
      handleError(error);
    } finally { setBusy(false); }
  }

  async function readRegistryHistory(more = false) {
    const item = registry.detail;
    const path = "registry-history/" + registry.kind + "/" + encodeURIComponent(item.id) + "?" + registryQuery();
    const rows = await requestList(path, more);
    const validSnapshot = (snapshot) => snapshot && snapshot.id === item.id && typeof snapshot.name === "string" && snapshot.workspaceId === registry.workspaceId &&
      snapshot.areaId === registry.areaId && ["Active", "Closed"].includes(snapshot.state) && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 1;
    if (!Array.isArray(rows) || rows.some((row) => !row || row.resource !== registry.kind || row.entityId !== item.id ||
      row.operation !== lifecycleActions.get(registry.kind).operation || !Number.isSafeInteger(row.revision) || row.revision < 2 ||
      typeof row.changedAt !== "string" || typeof row.actorAccountId !== "string" || typeof row.reason !== "string" ||
      !validSnapshot(row.before) || !validSnapshot(row.after) || row.before.revision + 1 !== row.revision || row.after.revision !== row.revision)) throw new ApiError(200, "некорректно_ответ", "");
    ui.registryHistory.replaceChildren();
    for (const row of rows) {
      const record = customerRecord("Версия записи " + row.revision + " · " + row.operation, [
        "Изменено: " + sessionTimestamp(row.changedAt), "Учетная запись: " + row.actorAccountId, "Основание: " + row.reason
      ]);
      const columns = document.createElement("div");
      columns.className = "registry-history-snapshots";
      for (const [title, snapshot] of [["До", row.before], ["После", row.after]]) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = title;
        details.append(summary, historySnapshot(snapshot));
        columns.append(details);
      }
      record.append(columns);
      ui.registryHistory.append(record);
    }
    $("registry-history-empty").hidden = rows.length !== 0;
    $("registry-history-empty").textContent = "Сервер не вернул изменений этой карточки. История создания в этот список не входит.";
    listContinuation(ui.registryHistory, path, () => readRegistryHistory(true), "Загрузить предыдущие изменения", rows);
  }

  async function openRegistryDetail(id) {
    if (busy || !registryContextReady() || !registry.rows.some((row) => row.id === id)) return;
    clearNotice();
    setBusy(true);
    try {
      const item = await request(registry.kind + "/" + encodeURIComponent(id) + "?" + registryQuery());
      checkedRegistryRows([item], state.workspaceId, registry.areaId);
      renderRegistryDetail(item);
    } catch (error) {
      if (error.status === 403) resetRegistry();
      handleError(error);
    }
    finally { setBusy(false); }
  }

  function registryPayload() {
    if (!registryContextReady()) throw new ApiError(403, "кабинет_область_запрещено", "");
    const payload = { workspaceId: state.workspaceId, areaId: registry.areaId };
    const createState = registryInputs.get("state").value;
    const forbiddenText = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ud800-\udfff]/;
    for (const field of registryFields()) {
      let value = registryInputs.get(field.name)?.value || "";
      if (registry.kind === "personal-accounts" && field.locked) {
        const contract = registryReference("contracts", registryInputs.get("contractId").value);
        value = contract?.[field.name] || "";
      }
      if (field.kind === "ref") {
        if (!registryReferenceAllowed(field.resource, registryReference(field.resource, value), createState)) throw new ApiError(409, "кабинет_реестр_связь_конфликт", "");
      } else if (field.kind === "choice") {
        if (!field.choices.some(([choice]) => choice === value)) throw new ApiError(400, "кабинет_реестр_некорректно_поле", "");
      } else if (field.kind === "date") {
        if (!value && field.optional) continue;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new ApiError(400, "кабинет_реестр_некорректно_даты", "");
        const date = new Date(value);
        if (!Number.isFinite(date.valueOf())) throw new ApiError(400, "кабинет_реестр_некорректно_даты", "");
        value = date.toISOString().replace(/\.\d{3}Z$/, "Z");
        if (value.length !== 20 || /^0001-01-01T00:00:00Z$/.test(value)) throw new ApiError(400, "кабинет_реестр_некорректно_даты", "");
      } else {
        if (value.length > field.max || forbiddenText.test(value)) throw new ApiError(400, "кабинет_реестр_некорректно_поле", "");
        value = value.trim();
        if (!value && !field.optional) throw new ApiError(400, "кабинет_реестр_некорректно_поле", "");
        if (field.ascii && /[^\x20-\x7e]/.test(value)) throw new ApiError(400, "кабинет_реестр_некорректно_поле", "");
        if (field.kind === "numberCode") {
          value = value.toUpperCase();
          if (!/^[A-Z0-9/_-]+$/.test(value) || !/[A-Z0-9]/.test(value)) throw new ApiError(400, "кабинет_реестр_некорректно_номер", "");
        }
      }
      payload[field.name] = value;
    }
    if (registry.kind === "contracts") {
      const property = registryReference("properties", payload.propertyId);
      const point = registryReference("service-points", payload.servicePointId);
      if (property.ownerSubscriberId !== payload.subscriberId || point.propertyId !== payload.propertyId || point.serviceKind !== payload.serviceKind) {
        throw new ApiError(409, "кабинет_реестр_связь_конфликт", "");
      }
      if (payload.validTo && Date.parse(payload.validTo) <= Date.parse(payload.validFrom)) throw new ApiError(400, "кабинет_реестр_некорректно_даты", "");
    }
    return payload;
  }

  function validPublicId(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
  }

  function resetCustomerPending() {
    $("pages-" + ui.customerPending.id)?.remove();
    customer.pending = [];
    customer.pendingScope = "";
    customer.pendingLoaded = false;
    customerPendingButtons = [];
    customerReasons = new Map();
    ui.customerPending.replaceChildren();
    $("customer-pending-empty").hidden = false;
    $("customer-pending-empty").textContent = "Очередь еще не загружена.";
  }

  function resetCustomer() {
    for (const control of [ui.customerRequests, ui.customerAccounts, m.accountSelect]) $("pages-" + control.id)?.remove();
    customer = emptyCustomer();
    customerButtons = [];
    resetCustomerPending();
    [ui.customerRequests, ui.customerAccounts, ui.customerDetail].forEach((element) => { element.replaceChildren(); });
    [ui.customerAccountId, ui.customerStaffLinkId, ui.customerStaffLinkRevision, ui.customerStaffReason].forEach((input) => { input.value = ""; });
    ui.customerStaffArea.replaceChildren();
    ["customer-request-count", "customer-account-count"].forEach((id) => { $(id).textContent = "0"; });
    for (const id of ["customer-requests-empty", "customer-accounts-empty"]) {
      $(id).hidden = false;
      $(id).textContent = "Список еще не загружен.";
    }
    $("customer-detail-empty").hidden = false;
  }

  function renderCustomerAccess() {
    const areas = state.areas.filter((area) => registryAreaAllowed(area.id));
    selectOptions(ui.customerStaffArea, areas.map((area) => [area.id, area.name]));
    const scope = state.workspaceId + "|" + ui.customerStaffArea.value;
    if (customer.pendingScope && (customer.pendingScope !== scope || !registryAreaAllowed(ui.customerStaffArea.value))) resetCustomerPending();
  }

  function customerRecord(titleText, lines) {
    const record = document.createElement("div");
    record.className = "record";
    const title = document.createElement("div");
    title.className = "record-title";
    title.textContent = titleText;
    const meta = document.createElement("div");
    meta.className = "record-meta";
    for (const text of lines) {
      const line = document.createElement("div");
      line.textContent = text;
      meta.append(line);
    }
    record.append(title, meta);
    return record;
  }

  function renderCustomerOwn() {
    customerButtons = [];
    ui.customerRequests.replaceChildren();
    ui.customerAccounts.replaceChildren();
    const requestNames = { Pending: "Ожидает проверки", Approved: "Одобрено", Rejected: "Отклонено", Cancelled: "Отменено" };
    for (const item of customer.requests) {
      const record = customerRecord(requestNames[item.state] || item.state, [
        "Подана: " + sessionTimestamp(item.createdAt)
      ]);
      meterSupport(record, [["ID заявки", item.id], ["ID лицевого счёта", item.personalAccountId], ["Версия записи", item.revision]]);
      if (item.state === "Pending") {
        const actions = document.createElement("div");
        actions.className = "record-actions";
        actions.append(actionButton("Отменить мою заявку", () => cancelCustomerRequest(item.id), true, customerButtons));
        record.append(actions);
      }
      ui.customerRequests.append(record);
    }
    for (const account of customer.accounts) {
      const record = customerRecord("Лицевой счет № " + account.numberNormalized, [
        account.address, account.state === "Closed" ? "Архивный счет · чтение" : "Действующий счет",
        expiration(account.expiresAt)
      ]);
      meterSupport(record, [["ID счёта", account.id]]);
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(actionButton(account.state === "Active" ? "Передать показание" : "История показаний", () => openMeterAccount(account.id), false, customerButtons),
        actionButton("Открыть мой счет", () => openCustomerAccount(account.id), false, customerButtons),
        actionButton("Отвязать от моего кабинета", () => unlinkCustomerAccount(account.id), true, customerButtons));
      record.append(actions);
      ui.customerAccounts.append(record);
    }
    $("customer-request-count").textContent = String(customer.requests.length);
    $("customer-account-count").textContent = String(customer.accounts.length);
    $("customer-requests-empty").hidden = customer.requests.length !== 0;
    $("customer-requests-empty").textContent = customer.loaded ? "В выборке ваших заявок записей нет." : "Список ещё не загружен.";
    $("customer-accounts-empty").hidden = customer.accounts.length !== 0;
    $("customer-accounts-empty").textContent = customer.loaded ? "Нет доступных лицевых счетов." : "Список ещё не загружен.";
    ui.customerDetail.replaceChildren();
    customer.detail = null;
    $("customer-detail-empty").hidden = false;
  }

  async function readCustomerOwn(moreKind = "") {
    const actor = state.me?.accountId, identity = state.me?.actorId;
    const [requests, accounts] = await Promise.all([
      moreKind === "accounts" ? customer.requests : requestList("account-link-requests", moreKind === "requests"),
      moreKind === "requests" ? customer.accounts : requestList("account/personal-accounts", moreKind === "accounts")]);
    if (!state.me || state.me.accountId !== actor || state.me.actorId !== identity) throw new ApiError(0, "счетчик_контекст_изменено", "");
    if (!Array.isArray(requests) || !Array.isArray(accounts) ||
        requests.some((item) => !validPublicId(item.id) || !validPublicId(item.personalAccountId) || !Number.isSafeInteger(item.revision) || item.revision < 0 || !["Pending", "Approved", "Rejected", "Cancelled"].includes(item.state)) ||
        accounts.some((item) => !validPublicId(item.id) || !validPublicId(item.linkId) || !Number.isSafeInteger(item.linkRevision) || item.linkRevision < 0 || !["Active", "Closed"].includes(item.state) || typeof item.address !== "string" || typeof item.numberNormalized !== "string")) {
      throw new ApiError(200, "некорректно_ответ", "");
    }
    customer.requests = requests;
    customer.accounts = accounts;
    customer.loaded = true;
    renderCustomerOwn();
    renderMeterAccounts();
    listContinuation(ui.customerRequests, "account-link-requests", () => readCustomerOwn("requests"), "Загрузить ещё заявки", requests);
    listContinuation(ui.customerAccounts, "account/personal-accounts", () => readCustomerOwn("accounts"), "Загрузить ещё счета", accounts);
    listContinuation(m.accountSelect, "account/personal-accounts", () => readCustomerOwn("accounts"), "Загрузить ещё мои счета", accounts);
  }

  async function readCustomerPending(more = false) {
    const areaId = ui.customerStaffArea.value;
    if (!registryAreaAllowed(areaId)) throw new ApiError(403, "кабинет_область_запрещено", "");
    const query = "workspaceId=" + encodeURIComponent(state.workspaceId) + "&areaId=" + encodeURIComponent(areaId);
    const path = "account-link-requests/pending?" + query;
    const pending = await requestList(path, more);
    if (!Array.isArray(pending) || pending.some((item) => item.workspaceId !== state.workspaceId || item.areaId !== areaId ||
        !validPublicId(item.id) || !validPublicId(item.personalAccountId) || !validPublicId(item.accountId) || item.state !== "Pending" || !Number.isSafeInteger(item.revision) || item.revision < 0)) {
      throw new ApiError(200, "некорректно_ответ", "");
    }
    resetCustomerPending();
    customer.pending = pending;
    customer.pendingScope = state.workspaceId + "|" + areaId;
    customer.pendingLoaded = true;
    for (const item of pending) {
      const record = customerRecord("Заявка на подтверждение", [
        "ID заявки: " + item.id, "ID учетной записи: " + item.accountId,
        "ID лицевого счета: " + item.personalAccountId, "Версия записи: " + item.revision,
        "Подана: " + sessionTimestamp(item.createdAt)
      ]);
      const reason = document.createElement("input");
      reason.type = "text";
      reason.className = "decision-reason";
      reason.maxLength = 250;
      reason.setAttribute("name", "customer-reason-" + item.id);
      reason.setAttribute("aria-label", "Основание решения по заявке " + item.id);
      reason.placeholder = "Основание проверки или отказа · обязательно";
      customerReasons.set(item.id, reason);
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(actionButton("ЛС в реестре", () => openPendingRegistryAccount(item.id), false, customerPendingButtons),
        actionButton("Подтвердить", () => decideCustomerRequest(item.id, "approve"), false, customerPendingButtons),
        actionButton("Отклонить заявку", () => decideCustomerRequest(item.id, "reject"), true, customerPendingButtons));
      record.append(reason, actions);
      ui.customerPending.append(record);
    }
    $("customer-pending-empty").hidden = pending.length !== 0;
    $("customer-pending-empty").textContent = "В выбранной области нет заявок в текущей выборке.";
    listContinuation(ui.customerPending, path, () => readCustomerPending(true), "Загрузить ещё заявки на привязку", pending);
  }

  function checkedCustomerReason(value, required) {
    if (typeof value !== "string" || value.length > 250 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(value) || (required && !value.trim())) {
      throw new ApiError(400, "кабинет_абонент_некорректно_причина", "");
    }
    return value.trim();
  }

  async function customerMutation(operation, message, refreshStaff = false) {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    let confirmed = false;
    try {
      await operation();
      confirmed = true;
      await readCustomerOwn();
      if (refreshStaff && registryAreaAllowed(ui.customerStaffArea.value)) await readCustomerPending();
      showNotice(message);
    } catch (error) {
      handleError(error);
      if (confirmed) showNotice("Изменение подтверждено, но списки не обновлены. " + errorMessage(error), true);
    } finally { setBusy(false); }
  }

  async function cancelCustomerRequest(id) {
    const item = customer.requests.find((row) => row.id === id);
    if (!item || item.state !== "Pending" || !Number.isSafeInteger(item.revision)) return;
    await customerMutation(() => request("account-link-requests/" + encodeURIComponent(id) + "/actions/cancel", {
      method: "POST", body: { expectedRevision: item.revision }
    }), "Ваша заявка отменена. Персональный доступ не создавался.");
  }

  async function decideCustomerRequest(id, action) {
    const item = customer.pending.find((row) => row.id === id);
    if (!item || !["approve", "reject"].includes(action) || !registryAreaAllowed(ui.customerStaffArea.value) ||
        customer.pendingScope !== state.workspaceId + "|" + ui.customerStaffArea.value) return;
    let reason;
    try { reason = checkedCustomerReason(customerReasons.get(id)?.value || "", true); }
    catch (error) { handleError(error); return; }
    customerReasons.get(id).value = "";
    await customerMutation(() => request("account-link-requests/" + encodeURIComponent(id) + "/actions/" + action, {
      method: "POST", body: { expectedRevision: item.revision, reason }
    }), action === "approve" ? "Персональная связь подтверждена по указанному основанию. Членство в пространстве не создавалось." : "Заявка отклонена по указанному основанию.", true);
  }

  async function openPendingRegistryAccount(id) {
    const item = customer.pending.find((row) => row.id === id);
    if (busy || !item || !registryAreaAllowed(item.areaId) || item.workspaceId !== state.workspaceId ||
        customer.pendingScope !== state.workspaceId + "|" + ui.customerStaffArea.value) return;
    clearNotice();
    setBusy(true);
    try {
      const dto = await request("personal-accounts/" + encodeURIComponent(item.personalAccountId) + "?workspaceId=" + encodeURIComponent(item.workspaceId) + "&areaId=" + encodeURIComponent(item.areaId));
      checkedRegistryRows([dto], item.workspaceId, item.areaId);
      resetRegistry();
      ui.registryEntity.value = "personal-accounts";
      ui.registryArea.value = item.areaId;
      registry.workspaceId = item.workspaceId;
      registry.areaId = item.areaId;
      registry.kind = "personal-accounts";
      buildRegistryForm();
      renderRegistryDetail(dto);
      showNotice("Карточка счёта открыта в реестре. Заявку на доступ нужно одобрить отдельно.");
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  async function openCustomerAccount(id) {
    if (busy || !state.me || !customer.accounts.some((item) => item.id === id)) return;
    clearNotice();
    setBusy(true);
    try {
      const item = await request("my/personal-accounts/" + encodeURIComponent(id));
      if (!item || item.id !== id || !validPublicId(item.linkId) || !Number.isSafeInteger(item.linkRevision)) throw new ApiError(200, "некорректно_ответ", "");
      customer.detail = item;
      ui.customerDetail.replaceChildren();
      const fields = [["numberNormalized", "Номер лицевого счёта"], ["address", "Адрес"], ["state", "Состояние счета"], ["expiresAt", "Срок доступа к счёту"]];
      for (const [key, label] of fields) {
        const group = document.createElement("div");
        const term = document.createElement("dt");
        const value = document.createElement("dd");
        term.textContent = label;
        value.textContent = key === "expiresAt" ? expiration(item[key]) : key === "state" ? (item[key] === "Closed" ? "Архивный · чтение" : "Действует") : String(item[key] ?? "Не указано");
        group.append(term, value);
        ui.customerDetail.append(group);
      }
      const supportGroup = document.createElement("div"), supportTerm = document.createElement("dt"), supportValue = document.createElement("dd");
      supportTerm.textContent = "Техническая справка";
      meterSupport(supportValue, [["ID счёта", item.id], ["ID связи", item.linkId], ["Версия записи связи", item.linkRevision], ["ID точки", item.servicePointId]]);
      supportGroup.append(supportTerm, supportValue);
      ui.customerDetail.append(supportGroup);
      $("customer-detail-empty").hidden = true;
    } catch (error) {
      if (error.status === 404 || error.status === 403) {
        customer.detail = null;
        ui.customerDetail.replaceChildren();
        $("customer-detail-empty").hidden = false;
        customer.accounts = customer.accounts.filter((account) => account.id !== id);
        renderCustomerOwn();
        renderMeterAccounts();
      }
      handleError(error);
    } finally { setBusy(false); }
  }

  async function unlinkCustomerAccount(id) {
    const item = customer.accounts.find((row) => row.id === id);
    if (!item || !validPublicId(item.linkId) || !Number.isSafeInteger(item.linkRevision)) return;
    await customerMutation(() => request("personal-account-links/" + encodeURIComponent(item.linkId) + "/actions/revoke", {
      method: "POST", body: { expectedRevision: item.linkRevision }
    }), "Персональная связь с вашим кабинетом отозвана. Служебные роли, если они есть, не изменились.");
  }

  async function openMeterAccount(id) {
    if (busy || !state.me || !customer.accounts.some((item) => item.id === id)) return;
    clearNotice();
    resetMeterView();
    m.mode.value = "personal";
    renderMeterAccounts();
    m.accountSelect.value = id;
    renderMeterAccounts();
    setBusy(true);
    try { await readMeterInstallations(); }
    catch (error) { meterFailure(error); }
    finally { setBusy(false); $("metering-heading").focus(); }
  }

  function meterStaffReady() {
    return meterStaff.loaded && registryAreaAllowed(m.staffArea.value) && meterStaff.scope === state.workspaceId + "|" + m.staffArea.value;
  }

  function resetMeterView(keepInstallations = false) {
    $("pages-meter-history-limit")?.remove();
    if (!keepInstallations) $("pages-" + m.installationSelect.id)?.remove();
    meterEpoch += 1;
    meterReading = emptyMeterReading();
    delete pendingCreations.meterReading;
    const previous = meterView;
    meterView = keepInstallations ? { ...previous, installation: null, readings: [], stale: false } : emptyMeterView();
    if (!keepInstallations) m.installationSelect.replaceChildren();
    [m.installationDetail, m.chart, m.historyBody].forEach((element) => { element.replaceChildren(); });
    m.correctionReading.replaceChildren();
    [m.measuredAt, m.measuredTime, m.readingValue, m.proposedAt, m.proposedValue, m.correctionReason].forEach((input) => { input.value = ""; });
    $("meter-history-container").hidden = true;
    $("meter-history-empty").hidden = false;
    $("meter-history-empty").textContent = "Выберите свой счёт и откройте прибор. История появится после загрузки.";
    $("meter-chart-caption").textContent = "";
    $("meter-correction-receipt").textContent = "";
    m.support.replaceChildren();
    $("meter-support").hidden = true;
    $("meter-support").open = false;
    m.context.textContent = "";
    clearMeterReadingError();
    renderMeterReadingState();
  }

  function resetMeterStaff() {
    for (const control of [m.passportsList, m.installAccount]) $("pages-" + control.id)?.remove();
    meterStaff = emptyMeterStaff();
    m.passportsList.replaceChildren();
    m.installPassport.replaceChildren();
    m.installAccount.replaceChildren();
    m.installPoint.value = "";
    [m.passportName, m.passportType, m.manufacturer, m.model, m.serial, m.digits, m.coefficient, m.verification,
      m.installedAt, m.admittedAt, m.initialValue].forEach((input) => { input.value = ""; });
    $("meter-passports-empty").hidden = false;
    $("meter-passports-empty").textContent = "Паспорта ещё не загружены. Список читается страницами по 25 записей.";
    if (meterView.authority === "staff") resetMeterView();
  }

  function resetMeterAll() {
    resetMeterView();
    resetMeterStaff();
    m.staffArea.replaceChildren();
    m.accountSelect.replaceChildren();
    m.mode.value = "personal";
    $("meter-account-summary").textContent = "";
    m.status.textContent = "Загрузите свои подтверждённые лицевые счета.";
  }

  function meterAccounts() {
    if (m.mode.value === "staff") return meterStaffReady() ? meterStaff.accounts.map((account) => ({ account, authority: "staff" })) : [];
    return customer.accounts.map((account) => ({ account, authority: "personal" }));
  }

  function meterAccount(id) { return meterAccounts().find((entry) => entry.account.id === id); }

  function renderMeterAccounts() {
    $("meter-mode-field").hidden = !meterStaffReady();
    if (!meterStaffReady() && m.mode.value === "staff") m.mode.value = "personal";
    const entries = meterAccounts();
    if (meterView.accountId) {
      const stillAuthorized = meterView.authority === "personal" ? customer.accounts.some((account) => account.id === meterView.accountId)
        : meterStaffReady() && meterStaff.accounts.some((account) => account.id === meterView.accountId);
      if (!stillAuthorized) resetMeterView();
    }
    selectOptions(m.accountSelect, entries.map(({ account }) => [account.id,
      "№ " + account.numberNormalized + " · " + (account.address || account.name || "Адрес не указан") + (account.state === "Closed" ? " · архив" : "")]));
    $("meter-account-field").hidden = entries.length <= 1;
    if (meterView.accountId && meterView.accountId !== m.accountSelect.value) resetMeterView();
    const selected = meterAccount(m.accountSelect.value);
    $("meter-account-summary").textContent = selected ? "Лицевой счёт № " + selected.account.numberNormalized + " · " + (selected.account.address || selected.account.name || "Адрес не указан") + (selected.account.state === "Closed" ? " · архивный, только чтение" : "") : customer.loaded ? "Подтверждённых счетов в этой выборке нет. Запросите доступ в разделе «Мои лицевые счета»." : "Счета ещё не загружены.";
    $("meter-authority-note").textContent = selected?.authority === "staff" ? "Служебный учёт выбранного участка." : "";
    renderMeterReadingState();
  }

  function renderMeterAccess() {
    $("metering").dataset.staffAvailable = String(state.areas.some(area => registryAreaAllowed(area.id)));
    selectOptions(m.staffArea, state.areas.filter((area) => registryAreaAllowed(area.id)).map((area) => [area.id, area.name]));
    if (meterStaff.scope && (meterStaff.scope !== state.workspaceId + "|" + m.staffArea.value || !registryAreaAllowed(m.staffArea.value))) resetMeterStaff();
    renderMeterAccounts();
  }

  function meterDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z)?$/.test(value)) return NaN;
    const canonical = value.replace(/Z$/, "");
    const time = Date.parse(canonical + "Z");
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === canonical ? time : NaN;
  }

  function meterTime(value) {
    return Number.isFinite(meterDate(value)) ? value.replace(/T/, " ").replace(/Z$/, "") + " UTC" : "Время недоступно";
  }

  function meterStatus(value) {
    return ({ Accepted: "Принято", LateReview: "На проверке", Active: "Действует", Closed: "В архиве", Pending: "Ожидает рассмотрения" })[value] || "Статус недоступен";
  }

  function meterSupport(parent, pairs) {
    const details = document.createElement("details");
    details.className = "resident-support";
    const summary = document.createElement("summary");
    summary.textContent = "Сведения для поддержки";
    details.append(summary);
    for (const [label, value] of pairs) {
      const line = document.createElement("p");
      line.textContent = label + ": " + String(value ?? "Не указано");
      details.append(line);
    }
    parent.append(details);
  }

  function clearMeterReadingError() {
    m.readingError.hidden = true;
    m.readingError.replaceChildren();
    for (const [input, hint] of [[m.measuredAt, "meter-reading-date-hint"], [m.measuredTime, "meter-reading-time-hint"], [m.readingValue, "meter-reading-value-hint"]]) {
      input.removeAttribute("aria-invalid");
      input.setAttribute("aria-describedby", hint);
    }
  }

  function showMeterReadingError(input, message) {
    clearMeterReadingError();
    const text = document.createElement("p");
    text.textContent = message;
    m.readingError.append(text);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", input.getAttribute("aria-describedby") + " meter-reading-error");
      const link = document.createElement("a");
      link.href = "#" + input.id;
      link.textContent = "Перейти к полю";
      link.addEventListener("click", (event) => { event.preventDefault(); input.focus(); });
      m.readingError.append(link);
    }
    m.readingError.hidden = false;
    m.readingError.focus();
  }

  function renderMeterReadingState() {
    const { phase, result, refreshFailed } = meterReading;
    $("metering").dataset.meterStage = meterView.installation || phase !== "idle" ? "reading" : meterView.accountId ? "device" : "account";
    m.readingResult.hidden = phase === "idle";
    m.readingResult.dataset.phase = phase;
    m.readingResult.dataset.refreshFailed = String(refreshFailed);
    m.retry.hidden = phase !== "unknown";
    m.refreshReading.hidden = !(phase === "confirmed" && refreshFailed);
    m.nextReading.hidden = phase !== "confirmed" || refreshFailed;
    $("meter-reading-diagnostics").hidden = !meterReading.diagnostic;
    $("meter-reading-diagnostics-text").textContent = meterReading.diagnostic || "";
    let heading = "", text = "";
    if (phase === "sending") {
      heading = "Ожидаем подтверждение";
      text = "Показание отправлено. Дождитесь ответа; повторная отправка сейчас недоступна.";
    } else if (phase === "unknown") {
      heading = "Исход отправки не подтверждён";
      text = "Результат отправки неизвестен. Повторите те же показания кнопкой ниже. Смена счёта или выход не отменяют отправку.";
    } else if (phase === "confirmed") {
      heading = result.state === "Accepted" ? "Показание принято" : "Показание получено и направлено на проверку";
      text = result.value + " м³ · измерено " + meterTime(result.measuredAt) + " · получено " + meterTime(result.receivedAt) + ". ";
      text += result.state === "LateReview" ? "Это более раннее измерение. Принятые показания и расход не изменены. " : "Сервер подтвердил запись. ";
      text += refreshFailed ? "Не удалось обновить прибор и историю. Не отправляйте показание заново; используйте обновление ниже." : "Прибор и загруженная история обновлены.";
    }
    $("meter-reading-result-heading").textContent = heading;
    $("meter-reading-result-text").textContent = text;
    const selected = meterAccount(meterView.accountId);
    $("meter-reading-note").textContent = !meterView.installation ? "Откройте прибор, чтобы проверить возможность подачи."
      : meterView.stale ? "Данные прибора требуют обновления. Новая подача недоступна до успешного чтения."
      : selected?.account.state === "Closed" ? "Счёт закрыт. Доступна только история."
      : meterView.installation.state !== "Active" ? "Прибор снят с учёта. Доступна только история."
      : !meterLivePassport(meterView.installation.passport) ? "Приём показаний недоступен: прибор неактивен или срок поверки истёк."
      : "Сверьте прибор, последнее принятое значение и фактическое время измерения.";
  }

  function meterReadingDTO(row, installation, payload = null) {
    const fields = "id,workspaceId,areaId,createdBy,createdAt,updatedAt,revision,meterInstallationId,personalAccountId,servicePointId,measuredAt,receivedAt,value,channel,state,reviewReason,previousReadingId,previousMeasuredAt,previousValue,consumption,coefficient".split(",");
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)) ||
      !validPublicId(row.id) || !validPublicId(row.createdBy) || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      row.meterInstallationId !== installation.id || row.personalAccountId !== installation.personalAccountId || row.servicePointId !== installation.servicePointId ||
      row.workspaceId !== installation.workspaceId || row.areaId !== installation.areaId || !["Accepted", "LateReview"].includes(row.state) ||
      ![row.createdAt, row.updatedAt, row.measuredAt, row.receivedAt, row.previousMeasuredAt].every((value) => Number.isFinite(meterDate(value))) ||
      ![row.value, row.previousValue, row.consumption, row.coefficient].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) ||
      row.coefficient <= 0 || typeof row.channel !== "string" || typeof row.reviewReason !== "string" ||
      (row.previousReadingId !== "" && !validPublicId(row.previousReadingId)) ||
      (payload && (row.value !== payload.value || meterDate(row.measuredAt) !== meterDate(payload.measuredAt)))) {
      throw new ApiError(200, "некорректно_ответ", "");
    }
    return row;
  }

  function sameMeterIntent(intent) {
    return !!state.me && meterReading.intent === intent && intent.epoch === meterEpoch && intent.actorId === state.me.accountId &&
      meterView.installation?.id === intent.payload.meterInstallationId && m.installationSelect.value === intent.payload.meterInstallationId;
  }

  async function sendMeterReading() {
    const intent = meterReading.intent;
    if (busy || !intent || !sameMeterIntent(intent) || !meterCanSubmit()) return;
    clearMeterReadingError();
    clearNotice();
    meterReading.phase = "sending";
    meterReading.diagnostic = "";
    renderMeterReadingState();
    setBusy(true);
    try {
      const response = await request("meter-readings", { method: "POST", headers: { "Idempotency-Key": intent.key }, body: intent.payload });
      if (!sameMeterIntent(intent)) return;
      meterReading.result = meterReadingDTO(response, meterView.installation, intent.payload);
      meterReading.phase = "confirmed";
      meterReading.refreshFailed = true;
      delete pendingCreations.meterReading;
      try {
        await readMeterDetail();
        if (!sameMeterIntent(intent)) return;
        meterReading.refreshFailed = false;
      } catch (error) {
        if (!sameMeterIntent(intent)) return;
        if (error.status === 401 || error.status === 403 || error.status === 404 || noNativeSession(error)) { meterFailure(error); return; }
        meterView.stale = true;
        m.status.textContent = "Прибор и историю пока не удалось обновить. Результат передачи показан ниже.";
        meterReading.diagnostic = error.code + (error.requestId ? " · " + error.requestId : "");
      }
    } catch (error) {
      if (!sameMeterIntent(intent)) return;
      if (error.status === 401 || error.status === 403 || error.status === 404 || noNativeSession(error)) { meterFailure(error); return; }
      if (!error.status || error.status < 300 || error.status >= 500) {
        meterReading.phase = "unknown";
        meterReading.diagnostic = error.code + (error.requestId ? " · " + error.requestId : "");
      } else {
        meterReading = emptyMeterReading();
        delete pendingCreations.meterReading;
        const input = ["кабинет_счетчик_некорректно_значение", "кабинет_счетчик_показание_уменьшено"].includes(error.code) ? m.readingValue
          : ["кабинет_счетчик_некорректно_даты", "кабинет_счетчик_временная_метка_конфликт"].includes(error.code) ? m.measuredAt : null;
        showMeterReadingError(input, errors[error.code] || "Сервис не принял показание. Проверьте данные и повторите отправку вручную.");
      }
    } finally {
      renderMeterReadingState();
      setBusy(false);
      if (sameMeterIntent(intent) && ["unknown", "confirmed"].includes(meterReading.phase)) $("meter-reading-result-heading").focus();
    }
  }

  function meterLivePassport(passport) {
    return !!passport && passport.state === "Active" && meterDate(passport.verificationUntil) > Date.now();
  }

  function meterCanSubmit() {
    const account = meterAccount(meterView.accountId);
    const installation = meterView.installation;
    return !!(account && !meterView.stale && account.account.state === "Active" && installation && installation.state === "Active" &&
      installation.personalAccountId === meterView.accountId && m.installationSelect.value === installation.id &&
      meterLivePassport(installation.passport));
  }

  function meterCanCorrect() {
    const account = meterAccount(meterView.accountId);
    return !!(account && !meterView.stale && meterReading.phase !== "unknown" && account.account.state === "Active" && meterView.installation &&
      meterView.installation.personalAccountId === meterView.accountId && m.installationSelect.value === meterView.installation.id);
  }

  function meterText(value, maximum) {
    if (typeof value !== "string" || value.length > maximum || !value.trim() || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(value)) throw new ApiError(400, "кабинет_счетчик_некорректно_поле", "");
    return value.trim();
  }

  function meterNumber(raw, minimum = 0, maximum = 999999999999.999, precision = 3) {
    const pattern = precision === 0 ? /^\d+$/ : /^\d+(?:\.\d{1,3})?$/;
    if (typeof raw !== "string" || !pattern.test(raw.trim())) throw new ApiError(400, "кабинет_счетчик_некорректно_значение", "");
    const value = Number(raw.trim());
    if (!Number.isFinite(value) || value < minimum || value > maximum || (precision === 0 && !Number.isInteger(value))) throw new ApiError(400, "кабинет_счетчик_некорректно_значение", "");
    return value;
  }

  function meterUTC(raw) {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) throw new ApiError(400, "кабинет_счетчик_некорректно_даты", "");
    const date = new Date(raw);
    const parts = raw.match(/\d+/g).map(Number);
    if (!Number.isFinite(date.valueOf()) || date.getFullYear() !== parts[0] || date.getMonth() + 1 !== parts[1] || date.getDate() !== parts[2] ||
      date.getHours() !== parts[3] || date.getMinutes() !== parts[4] || date.getSeconds() !== (parts[5] || 0)) throw new ApiError(400, "кабинет_счетчик_некорректно_даты", "");
    const value = date.toISOString().replace(/\.\d{3}Z$/, "Z");
    if (value.length !== 20) throw new ApiError(400, "кабинет_счетчик_некорректно_даты", "");
    return value;
  }

  function meterValueForPassport(raw, passport) {
    const value = meterNumber(raw);
    if (!passport || !Number.isInteger(passport.digits) || value >= 10 ** passport.digits) throw new ApiError(400, "кабинет_счетчик_некорректно_значение", "");
    return value;
  }

  function renderMeterStaff() {
    m.passportsList.replaceChildren();
    for (const passport of meterStaff.passports) {
      m.passportsList.append(customerRecord(passport.name, [
        passport.manufacturer + " · " + passport.model + " · № " + passport.serialNumber,
        "ID: " + passport.id, "Разряды: " + passport.digits + " · коэффициент " + passport.coefficient + " · м³",
        "Поверка до: " + sessionTimestamp(passport.verificationUntil), passport.state + (meterLivePassport(passport) ? "" : " · прием запрещен")
      ]));
    }
    $("meter-passports-empty").hidden = meterStaff.passports.length !== 0;
    $("meter-passports-empty").textContent = "В текущей выборке паспортов нет.";
    selectOptions(m.installPassport, meterStaff.passports.filter(meterLivePassport).map((passport) => [passport.id, passport.name + " · " + passport.serialNumber]));
    selectOptions(m.installAccount, meterStaff.accounts.filter((account) => account.state === "Active").map((account) => [account.id, account.numberNormalized + " · " + account.name]));
    updateMeterInstallPoint();
    renderMeterAccounts();
  }

  function updateMeterInstallPoint() {
    const account = meterStaff.accounts.find((row) => row.id === m.installAccount.value);
    m.installPoint.value = account?.servicePointId || "";
  }

  async function readMeterStaff(moreKind = "") {
    const areaId = m.staffArea.value;
    if (!registryAreaAllowed(areaId)) throw new ApiError(403, "кабинет_область_запрещено", "");
    const query = "workspaceId=" + encodeURIComponent(state.workspaceId) + "&areaId=" + encodeURIComponent(areaId);
    const passportPath = "meter-passports?" + query, accountPath = "personal-accounts?" + query;
    const [passports, accounts] = await Promise.all([
      moreKind === "accounts" ? meterStaff.passports : requestList(passportPath, moreKind === "passports"),
      moreKind === "passports" ? meterStaff.accounts : requestList(accountPath, moreKind === "accounts")]);
    if (!Array.isArray(passports) || passports.some((passport) => !validPublicId(passport.id) ||
      passport.workspaceId !== state.workspaceId || passport.areaId !== areaId || typeof passport.name !== "string" || !Number.isInteger(passport.digits) || typeof passport.coefficient !== "number")) throw new ApiError(200, "некорректно_ответ", "");
    checkedRegistryRows(accounts, state.workspaceId, areaId);
    meterStaff = { scope: state.workspaceId + "|" + areaId, loaded: true, passports, accounts };
    renderMeterStaff();
    listContinuation(m.passportsList, passportPath, () => readMeterStaff("passports"), "Загрузить ещё паспорта", passports);
    listContinuation(m.installAccount, accountPath, () => readMeterStaff("accounts"), "Загрузить ещё лицевые счета", accounts);
  }

  function meterFailure(error, staff = false) {
    if (error.code === "счетчик_контекст_изменено") return;
    const selected = meterAccount(m.accountSelect.value);
    const accountId = meterView.accountId || selected?.account.id;
    const authority = meterView.authority || selected?.authority;
    if (error.status === 403 || error.status === 404) {
      if (staff) resetMeterStaff();
      else resetMeterView();
      if (authority === "personal" && error.code === "кабинет_абонент_учетная_запись_не_найдено") {
        customer.accounts = customer.accounts.filter((account) => account.id !== accountId);
        renderCustomerOwn();
      }
      renderMeterAccounts();
    }
    m.status.textContent = error.status === 403 || error.status === 404 ? "Доступ к выбранному счёту или прибору недоступен. Данные очищены. Обновите свои счета."
      : "Не удалось загрузить данные. Повторите чтение вручную; это не означает, что записей нет.";
    renderMeterReadingState();
    handleError(error);
  }

  async function readMeterInstallations(more = false) {
    const selected = meterAccount(m.accountSelect.value);
    if (!selected) throw new ApiError(404, "кабинет_абонент_учетная_запись_не_найдено", "");
    const epoch = meterEpoch, actor = state.me?.accountId;
    m.status.textContent = "Загружаем приборы выбранного счёта…";
    const path = "meter-installations?personalAccountId=" + encodeURIComponent(selected.account.id);
    const installations = await requestList(path, more);
    if (meterEpoch !== epoch || state.me?.accountId !== actor || m.accountSelect.value !== selected.account.id) throw new ApiError(0, "счетчик_контекст_изменено", "");
    if (!Array.isArray(installations) || installations.some((item) => !validPublicId(item.id) || item.personalAccountId !== selected.account.id ||
      item.workspaceId !== selected.account.workspaceId || item.areaId !== selected.account.areaId || item.servicePointId !== selected.account.servicePointId || !["Active", "Closed"].includes(item.state))) throw new ApiError(200, "некорректно_ответ", "");
    if (!more) resetMeterView();
    meterView.accountId = selected.account.id;
    meterView.authority = selected.authority;
    meterView.installations = installations;
    selectOptions(m.installationSelect, installations.map((item, index) => [item.id, "Прибор " + (index + 1) + " в выборке · " + meterStatus(item.state) + " · допуск " + meterTime(item.admittedAt)]));
    $("meter-installation-field").hidden = installations.length <= 1;
    $("meter-history-empty").textContent = installations.length ? "Откройте выбранный прибор и историю." : "В загруженной выборке этого счёта приборов нет.";
    m.status.textContent = installations.length ? "Загружено приборов: " + installations.length + ". Для продолжения нажмите «Загрузить ещё»." : "В этой выборке приборов нет. Можно обновить счета или выбрать другой счёт.";
    listContinuation(m.installationSelect, path, () => readMeterInstallations(true), "Загрузить ещё приборы", installations);
    if (!more && installations.length === 1 && !listPages.get(path)?.hasMore) await readMeterDetail();
  }

  function meterDetailLine(label, text, target = m.installationDetail) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = label;
    value.textContent = String(text);
    group.append(term, value);
    target.append(group);
  }

  function renderMeterChart() {
    m.chart.replaceChildren();
    const installation = meterView.installation;
    if (!installation) return;
    const accepted = meterView.readings.filter((row) => row.state === "Accepted").sort((left, right) => meterDate(left.measuredAt) - meterDate(right.measuredAt));
    if (accepted.length !== installation.acceptedHead.acceptedCount) {
      $("meter-chart-caption").textContent = "Исходный ряд неполон: загружено принятых показаний " + accepted.length + ", сервер сообщает " + installation.acceptedHead.acceptedCount + ". Загрузите следующие страницы. Ряд с решениями о корректировках доступен в разделе «Приборы и доставка воды».";
      return;
    }
    const sequence = [{ value: installation.initialValue, measuredAt: installation.admittedAt }, ...accepted];
    const values = sequence.map((row) => row.value);
    const low = Math.min(...values);
    const range = Math.max(...values) - low || 1;
    const times = sequence.map((row) => meterDate(row.measuredAt));
    const start = Math.min(...times);
    const duration = Math.max(...times) - start;
    const coordinates = sequence.map((row, index) => [duration > 0 ? 20 + 600 * (times[index] - start) / duration : 20, 160 - (row.value - low) * 130 / range]);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 640 195");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Начальная база и только принятые показания по времени измерения");
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("class", "meter-chart-line");
    line.setAttribute("points", coordinates.map(([x, y]) => x.toFixed(2) + "," + y.toFixed(2)).join(" "));
    svg.append(line);
    coordinates.forEach(([x, y], index) => {
      const point = document.createElementNS(ns, "circle");
      point.setAttribute("cx", x.toFixed(2));
      point.setAttribute("cy", y.toFixed(2));
      point.setAttribute("r", index === 0 ? "4" : "3");
      point.setAttribute("class", "meter-chart-point" + (index === 0 ? " meter-chart-baseline" : ""));
      svg.append(point);
      if (index === 0 || index === sequence.length - 1) {
        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", x.toFixed(2));
        label.setAttribute("y", String(Math.max(15, y - 12)));
        label.setAttribute("text-anchor", index === 0 ? "start" : "end");
        label.setAttribute("class", "meter-chart-label");
        label.textContent = (index === 0 ? "При установке " : "Принято ") + sequence[index].value;
        svg.append(label);
      }
    });
    m.chart.append(svg);
    $("meter-chart-caption").textContent = "Исходные показания без последующих корректировок. Записи на проверке не включены. Принятых показаний: " + accepted.length + ". Действующий ряд с решениями о корректировках смотрите в разделе «Приборы и доставка воды».";
  }

  function renderMeterHistory() {
    const installation = meterView.installation;
    const passport = installation.passport;
    m.installationDetail.replaceChildren();
    const account = meterAccount(meterView.accountId)?.account;
    m.context.textContent = "Лицевой счёт № " + (account?.numberNormalized || "не указан") + " · " + (account?.address || account?.name || "Адрес не указан");
    for (const [label, text] of [
      ["Прибор", passport.name], ["Производитель / модель", passport.manufacturer + " / " + passport.model],
      ["Заводской номер", passport.serialNumber], ["Статус прибора", meterStatus(installation.state)],
      ["Поверка действует до", meterTime(passport.verificationUntil)],
      [installation.acceptedHead.acceptedCount ? "Последнее принятое показание, м³" : "Начальное значение при установке, м³", installation.acceptedHead.value],
      [installation.acceptedHead.acceptedCount ? "Время последнего принятого измерения" : "Время допуска прибора", meterTime(installation.acceptedHead.measuredAt)]
    ]) meterDetailLine(label, text);
    m.support.replaceChildren();
    for (const [label, value] of [["ID установки", installation.id], ["ID счёта", installation.personalAccountId], ["ID точки", installation.servicePointId],
      ["Разряды / коэффициент", passport.digits + " / " + passport.coefficient], ["Начальное значение", installation.initialValue], ["Допуск", meterTime(installation.admittedAt)]]) meterDetailLine(label, value, m.support);
    $("meter-support").hidden = false;
    m.historyBody.replaceChildren();
    for (const reading of meterView.readings) {
      const row = document.createElement("tr");
      appendCell(row, meterStatus(reading.state), reading.state === "Accepted" ? "meter-reading-accepted" : "meter-reading-late");
      appendCell(row, meterTime(reading.measuredAt));
      appendCell(row, meterTime(reading.receivedAt));
      appendCell(row, String(reading.value));
      const delta = reading.state === "Accepted" ? String(Number((reading.value - reading.previousValue).toFixed(3))) : "не учитывается";
      const previous = appendCell(row, String(reading.previousValue) + " / Δ " + delta);
      const previousAt = document.createElement("small");
      previousAt.textContent = meterTime(reading.previousMeasuredAt);
      previous.append(previousAt);
      appendCell(row, String(reading.consumption) + " / × " + reading.coefficient);
      const meta = appendCell(row, reading.state === "LateReview" ? "Более раннее измерение. Требуется проверка; расход не пересчитан." : "Учтено в принятой последовательности");
      meterSupport(meta, [["ID показания", reading.id], ["Канал", reading.channel], ["Код причины", reading.reviewReason || "нет"]]);
      m.historyBody.append(row);
    }
    selectOptions(m.correctionReading, meterView.readings.filter((reading) => reading.state === "Accepted").map((reading) => [reading.id,
      meterTime(reading.measuredAt) + " · " + reading.value + " м³"]));
    $("meter-history-container").hidden = meterView.readings.length === 0;
    $("meter-history-empty").hidden = meterView.readings.length !== 0;
    $("meter-history-empty").textContent = "Присланных измерений в выборке нет. Начальная база показана отдельно; это не запись измерения.";
    $("meter-history-limit").textContent = "Загружено показаний: " + meterView.readings.length + ". График строится по загруженным страницам; текущее принятое значение показано отдельно.";
    renderMeterChart();
    renderMeterReadingState();
  }

  async function readMeterDetail(more = false) {
    const id = m.installationSelect.value;
    const account = meterAccount(meterView.accountId)?.account;
    if (!account || !meterView.installations.some((item) => item.id === id)) throw new ApiError(404, "кабинет_счетчик_не_найдено", "");
    const epoch = meterEpoch, actor = state.me?.accountId;
    meterView.stale = true;
    m.status.textContent = "Обновляем прибор и историю…";
    const path = "meter-readings?meterInstallationId=" + encodeURIComponent(id);
    const [installation, readings] = await Promise.all([
      request("meter-installations/" + encodeURIComponent(id)), requestList(path, more)
    ]);
    if (meterEpoch !== epoch || state.me?.accountId !== actor || m.installationSelect.value !== id || meterView.accountId !== account.id) throw new ApiError(0, "счетчик_контекст_изменено", "");
    if (!installation || installation.id !== id || installation.personalAccountId !== meterView.accountId || !installation.passport ||
        installation.workspaceId !== account.workspaceId || installation.areaId !== account.areaId || installation.servicePointId !== account.servicePointId ||
        !["Active", "Closed"].includes(installation.state) || !["Active", "Closed"].includes(installation.passport.state) ||
        installation.passport.id !== installation.passportId || installation.passport.workspaceId !== installation.workspaceId || installation.passport.areaId !== installation.areaId ||
        ![installation.passport.name, installation.passport.manufacturer, installation.passport.model, installation.passport.serialNumber].every((value) => typeof value === "string") ||
        ![installation.installedAt, installation.admittedAt, installation.passport.verificationUntil].every((value) => Number.isFinite(meterDate(value))) ||
        !Number.isInteger(installation.passport.digits) || installation.passport.digits < 1 || installation.passport.digits > 12 ||
        !Number.isFinite(installation.passport.coefficient) || installation.passport.coefficient <= 0 || !Number.isFinite(installation.initialValue) || installation.initialValue < 0 ||
        !installation.acceptedHead || !Number.isFinite(installation.acceptedHead.value) || installation.acceptedHead.value < 0 ||
        !Number.isFinite(meterDate(installation.acceptedHead.measuredAt)) || !Number.isSafeInteger(installation.acceptedHead.acceptedCount) || installation.acceptedHead.acceptedCount < 0 ||
        (installation.acceptedHead.acceptedCount > 0 ? !validPublicId(installation.acceptedHead.readingId) : installation.acceptedHead.readingId !== "") ||
        !Array.isArray(readings) || new Set(readings.map((row) => row?.id)).size !== readings.length) {
      throw new ApiError(200, "некорректно_ответ", "");
    }
    readings.forEach((reading) => meterReadingDTO(reading, installation));
    meterView.installation = installation;
    meterView.readings = readings;
    meterView.stale = false;
    renderMeterHistory();
    listContinuation("meter-history-limit", path, () => readMeterDetail(true), "Загрузить следующие показания", readings);
    m.status.textContent = "Прибор и выборка истории загружены. Проверяйте время измерения и значение перед подачей.";
  }

  async function meterMutation(kind, path, payload, after, message, staff = false) {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    let confirmed = false;
    try {
      const result = await request(path, { method: "POST", headers: { "Idempotency-Key": creationKey(kind, { path, payload }) }, body: payload });
      if (!result || !validPublicId(result.id)) throw new ApiError(200, "некорректно_ответ", "");
      if (kind === "meterCorrection" && (result.state !== "Pending" || result.meterInstallationId !== meterView.installation?.id ||
        result.personalAccountId !== meterView.accountId || result.readingId !== m.correctionReading.value ||
        result.proposedValue !== payload.proposedValue || meterDate(result.proposedMeasuredAt) !== meterDate(payload.proposedMeasuredAt))) throw new ApiError(200, "некорректно_ответ", "");
      confirmed = true;
      await after(result);
      showNotice(typeof message === "function" ? message(result) : message);
    } catch (error) {
      meterFailure(error, staff);
      if (confirmed) showNotice("Операция подтверждена, но обновление представления не завершено. " + errorMessage(error), true);
      else if (["сеть_ошибка", "таймаут_ошибка"].includes(error.code)) showNotice("Результат отправки неизвестен. Повторите ту же операцию кнопкой ниже, не меняя данные.", true);
    } finally { setBusy(false); }
  }

  function updateScopeFields() {
    $("role-area-field").hidden = ui.roleScope.value !== "Area";
    $("invitation-area-field").hidden = ui.invitationScope.value !== "Area";
    setBusy(busy);
    updateAssignmentButton();
  }

  async function invitationAction(id, action) {
    const items = action === "revoke" ? state.outgoing : state.incoming;
    const invitation = items.find((item) => item.id === id);
    if (!invitation || busy || !state.me) return;
    if (action === "revoke") {
      if (!isOwner() || invitation.inviterAccountId !== state.me.accountId || !["Pending", "Accepted"].includes(invitation.state)) return;
    } else if (!["accept", "decline"].includes(action) || invitation.recipientAccountId !== state.me.accountId || invitation.state !== "Pending") return;
    if (!Number.isSafeInteger(invitation.revision) || invitation.revision < 0) return;
    await mutate(() => request("invitations/" + encodeURIComponent(id) + "/actions/" + action, {
      method: "POST", body: { expectedRevision: invitation.revision }
    }), action === "accept" ? "Приглашение принято. Список пространств и назначений обновлен."
      : action === "decline" ? "Приглашение отклонено." : "Приглашение отозвано. Состояние назначений обновлено.");
  }

  async function deactivateMembership(id) {
    const member = state.memberships.find((item) => item.id === id);
    if (busy || !isOwner() || !member || !roles.has(member.role) || member.state !== "Active" || !Number.isSafeInteger(member.revision)) return;
    await mutate(() => request("memberships/" + encodeURIComponent(id) + "/actions/deactivate", {
      method: "POST", body: { workspaceId: state.workspaceId, expectedRevision: member.revision }
    }), "Локальное назначение отключено. Остальные назначения участника не изменены.");
  }

  function renderMemberships() {
    ui.membershipsBody.replaceChildren();
    for (const member of state.memberships) {
      const row = document.createElement("tr");
      const roleCell = appendCell(row, "");
      const roleName = document.createElement("div");
      roleName.className = "role-label";
      roleName.textContent = member.role === "WorkspaceOwner" ? "Владелец пространства" : roles.get(member.role) || member.role;
      const roleCode = document.createElement("small");
      roleCode.textContent = member.role;
      roleCell.append(roleName, roleCode);
      const accountCell = appendCell(row, "");
      if (member.accountId === state.me.accountId) {
        const self = document.createElement("div");
        self.className = "member-self";
        self.textContent = "Вы";
        accountCell.append(self);
      }
      const account = document.createElement("div");
      account.className = "member-id";
      account.textContent = member.accountId;
      account.title = member.accountId;
      accountCell.append(account);
      const areaCell = appendCell(row, member.areaScope === "All" ? "Все пространство" : areaLabel(member.areaId));
      if (member.areaId) {
        const area = document.createElement("small");
        area.textContent = member.areaId;
        areaCell.append(area);
      }
      const statusCell = appendCell(row, "");
      const status = document.createElement("span");
      const active = currentMembership(member);
      status.className = "membership-status" + (active ? "" : " inactive");
      status.textContent = active ? "Действует" : member.state === "Active" ? "Срок истек" : "Неактивно";
      const expiry = document.createElement("small");
      expiry.textContent = expiration(member.expiresAt);
      statusCell.append(status, expiry);
      appendCell(row, String(member.revision));
      const actionCell = appendCell(row, "—");
      if (isOwner() && roles.has(member.role) && member.state === "Active") {
        actionCell.textContent = "";
        const button = actionButton("Отключить", () => deactivateMembership(member.id), true);
        button.className += " table-action";
        button.setAttribute("aria-label", "Отключить роль " + roleName.textContent + " учетной записи " + member.accountId);
        actionCell.append(button);
      }
      ui.membershipsBody.append(row);
    }
    $("role-count").textContent = String(state.memberships.length);
    $("memberships-container").hidden = state.memberships.length === 0;
    $("memberships-empty").hidden = state.memberships.length !== 0;
    $("membership-visibility").textContent = !selectedWorkspace() ? "Выберите пространство" : isOwner()
      ? "Загруженные назначения пространства" : "Загруженные собственные назначения";
    $("assignment-note").textContent = isOwner()
      ? "Выберите участника из списка. Новому участнику сначала отправьте приглашение."
      : "Роли назначает владелец рабочего пространства.";
  }

  function renderWorkspaceChoices() {
    ui.workspaceSelect.replaceChildren();
    const choices = [...state.workspaces], selected = selectedWorkspace();
    if (selected && !choices.some(row => row.id === selected.id)) choices.unshift(selected);
    for (const workspace of choices) {
      const option = document.createElement("option");
      option.value = workspace.id;
      option.textContent = workspace.name;
      ui.workspaceSelect.append(option);
    }
    if (!choices.length) {
      const option = document.createElement("option");
      option.textContent = "Нет доступных пространств";
      option.value = "";
      ui.workspaceSelect.append(option);
    }
    ui.workspaceSelect.value = state.workspaceId;
  }

  function iamPath(kind) {
    if (kind === "workspaces") return "workspaces";
    if (kind === "incoming") return "invitations";
    return (kind === "outgoing" ? "invitations" : kind) + "?workspaceId=" + encodeURIComponent(state.workspaceId);
  }

  function validateIAMRows(kind, rows, workspaceId = "") {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const page = pendingListPages.get(rows);
    if (!Array.isArray(rows) || page?.legacy || rows.some(row => !row || !uuid.test(row.id) ||
        workspaceId && row.workspaceId !== workspaceId ||
        ["workspaces", "areas"].includes(kind) && (typeof row.name !== "string" || row.name.length > 150) ||
        kind === "memberships" && (!uuid.test(row.accountId) || !(row.role === "WorkspaceOwner" || roles.has(row.role)) ||
          !["All", "Area"].includes(row.areaScope) || !Number.isSafeInteger(row.revision)))) throw new ApiError(200, "некорректно_ответ", "");
  }

  function authorityChanged(previous, next) {
    if (!previous || !next) return previous !== next;
    const sameRoles = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    return previous.owner !== next.owner || previous.expiresAt !== next.expiresAt ||
      !sameRoles(previous.roles, next.roles) || !sameRoles(previous.workspaceRoles, next.workspaceRoles) ||
      previous.areas.some(area => {
        const current = next.areas.find(row => row.id === area.id);
        return !current || !sameRoles(area.roles, current.roles);
      });
  }

  async function readIAMContinuation(kind) {
    const path = iamPath(kind), items = await requestList(path, true);
    validateIAMRows(kind, items, ["memberships", "areas", "outgoing"].includes(kind) ? state.workspaceId : "");
    if (["memberships", "areas"].includes(kind)) {
      const snapshot = { ...state, [kind]: items };
      let authority;
      try { authority = await readAuthority(snapshot); }
      catch (error) {
        invalidateHostContext(); clearPackageContext("orders"); clearPackageContext("hydrology");
        setBusy(false);
        throw error;
      }
      if (authorityChanged(state.authority, authority)) {
        try { await loadDashboard(state.workspaceId); }
        finally { setBusy(false); }
        showNotice("Полномочия изменились. Списки и частные разделы обновлены с первой страницы.");
        return;
      }
      state.authority = authority; state.workspace = authority?.workspace || null; scheduleAuthorityExpiry();
    }
    state[kind] = items;
    if (kind === "workspaces") renderWorkspaceChoices();
    else if (kind === "memberships") { renderMemberships(); renderAreas(); updateAssignmentButton(); }
    else if (kind === "areas") {
      renderAreas(); renderRegistryAccess(); renderCustomerAccess(); renderMeterAccess(); renderWaterAccess(); renderDispatchAccess();
      syncLabContext(); syncLabStaffContext(); syncInventoryContext(); syncWorkMaterialsContext();
      syncPackageContext("orders"); syncPackageContext("hydrology"); syncAdditionalModules();
    } else renderInvitations();
    renderIAMPages();
  }

  function renderIAMPages() {
    const controls = [["workspaces", "workspace-select", "пространства"], ["memberships", "memberships-container", "назначения"],
      ["areas", "areas-list", "участки"], ["incoming", "incoming-list", "приглашения"], ["outgoing", "outgoing-list", "приглашения"]];
    for (const [kind, anchor, label] of controls) {
      if (["memberships", "areas", "outgoing"].includes(kind) && !state.workspaceId || kind === "outgoing" && !isOwner()) {
        document.getElementById("pages-" + anchor)?.remove(); continue;
      }
      listContinuation(anchor, iamPath(kind), () => readIAMContinuation(kind), "Загрузить ещё " + label, state[kind]);
    }
  }

  function render() {
    if (!state.me) return;
    contextRendered = false;
    globalThis.VodokanalIdentity?.clearPublic?.();
    ui.login.hidden = true;
    ui.app.hidden = false;
    $("profile-heading").textContent = state.me.nativeName;
    $("identity-name").textContent = state.me.nativeName;
    $("profile-avatar").textContent = Array.from(state.me.nativeName || "В")[0].toLocaleUpperCase("ru-RU");
    $("account-id").textContent = state.me.accountId;
    $("actor-id").textContent = state.me.actorId;
    const session = state.me.session || {};
    $("idle-timeout").textContent = duration(session.idleTimeoutSeconds);
    $("session-summary").textContent = "До завершения сеанса: " + duration(session.remainingSeconds);
    renderWorkspaceChoices();
    const workspace = selectedWorkspace();
    $("workspace-details").hidden = !workspace;
    $("workspace-empty").hidden = !!workspace;
    if (workspace) {
      $("workspace-state").textContent = workspace.state === "Active" ? "Активно" : workspace.state;
      $("workspace-ownership").textContent = workspace.ownerAccountId === state.me.accountId ? "Личное пространство" : "Участник";
      $("workspace-profile").textContent = "Профиль " + workspace.profile;
    }
    actionButtons = [];
    renderMemberships();
    renderAreas();
    renderInvitations();
    renderIAMPages();
    renderSessions();
    renderRegistryAccess();
    renderCustomerAccess();
    renderMeterAccess();
    renderWaterAccess();
    renderDispatchAccess();
    syncLabContext();
    syncLabStaffContext();
    syncInventoryContext();
    syncWorkMaterialsContext();
    syncPackageContext("orders");
    syncPackageContext("hydrology");
    syncAdditionalModules();
    updateAssignmentButton();
    contextRendered = true;
    setBusy(busy);
  }

  function updateAssignmentButton() {
    const areaId = ui.roleScope.value === "Area" ? ui.roleArea.value : "";
    const existing = state.me && state.memberships.find((row) => row.accountId === ui.roleTarget.value &&
      row.role === ui.roleSelect.value && row.areaScope === ui.roleScope.value && row.areaId === areaId);
    ui.assignButton.textContent = existing ? "Обновить назначение +" : "Назначить роль +";
  }

  function validateIdentity(me) {
    if (!me || typeof me.nativeName !== "string" || typeof me.accountId !== "string" || typeof me.actorId !== "string") {
      throw new ApiError(200, "некорректно_ответ", "");
    }
  }

  function waterAreaAllowed(areaId) {
    return !!(state.me && state.areas.some((area) => area.id === areaId && area.workspaceId === state.workspaceId && area.state === "Active") &&
      roleMemberships().some((member) => member.accountId === state.me.accountId && member.workspaceId === state.workspaceId &&
        member.role === "WaterOperator" && currentMembership(member) &&
        ((member.areaScope === "All" && !member.areaId) || (member.areaScope === "Area" && member.areaId === areaId))));
  }

  function waterReady() { return water.loaded && water.scope === state.workspaceId + "|" + w.area.value && waterAreaAllowed(w.area.value); }
  function waterSetupRef(kind, id) { return water.setup[kind]?.find((row) => row.id === id && row.state === "Active"); }
  function waterScopeBody() {
    if (!waterReady()) throw new ApiError(403, "кабинет_область_запрещено", "");
    return { workspaceId: state.workspaceId, areaId: w.area.value };
  }
  function waterQuery(pointId = "") {
    return "workspaceId=" + encodeURIComponent(state.workspaceId) + "&areaId=" + encodeURIComponent(w.area.value) + (pointId ? "&pointId=" + encodeURIComponent(pointId) : "");
  }

  function clearWaterDetail() {
    water.detail = null;
    water.stale = false;
    w.orderDetail.replaceChildren();
    w.action.replaceChildren();
    w.returnQuantity.value = "";
    w.returnReason.value = "";
    w.actionForm.hidden = true;
    $("water-return-fields").hidden = true;
    $("water-order-detail-empty").hidden = false;
    $("water-order-action-note").textContent = "";
  }

  function clearWaterPoint() {
    $("pages-" + w.movements.id)?.remove();
    water.pointId = "";
    water.balances = null;
    water.movements = [];
    w.balances.replaceChildren();
    w.movements.replaceChildren();
    $("water-balances-empty").hidden = false;
    $("water-balances-empty").textContent = "Выберите точку из загруженного справочника. Остатки еще не загружены.";
    $("water-movements-empty").hidden = false;
    $("water-movements-empty").textContent = "Движения еще не загружены.";
  }

  function resetWater() {
    $("pages-" + w.ordersList.id)?.remove();
    water = emptyWater();
    waterButtons = [];
    for (const key of Object.keys(pendingCreations)) if (key.startsWith("water:")) delete pendingCreations[key];
    [w.setupList, w.ordersList, w.point, w.source, w.receiptPoint, w.orderPoint, w.recipient].forEach((control) => { control.replaceChildren(); });
    [w.setupName, w.occurredAt, w.basis, w.quantity, w.orderQuantity, w.scheduledAt].forEach((input) => { input.value = ""; });
    w.setupKind.value = "sources";
    clearWaterDetail();
    clearWaterPoint();
    $("water-orders-empty").hidden = false;
    $("water-orders-empty").textContent = "Заказы еще не загружены.";
  }

  function renderWaterAccess() {
    const areas = state.areas.filter((area) => waterAreaAllowed(area.id));
    selectOptions(w.area, areas.map((area) => [area.id, area.name]));
    if (water.scope && (!waterAreaAllowed(w.area.value) || water.scope !== state.workspaceId + "|" + w.area.value)) resetWater();
    $("water-access-note").textContent = areas.length ? "Выберите участок для работы с запасами и заказами воды." :
      "Нет доступа к запасам и заказам воды. Обратитесь к владельцу рабочей области.";
  }

  function waterCheckedCommon(row) {
    return row && validPublicId(row.id) && row.workspaceId === state.workspaceId && row.areaId === w.area.value && Number.isSafeInteger(row.revision) && row.revision >= 1;
  }

  function waterCheckedOrder(row) {
    if (!waterCheckedCommon(row) || !validPublicId(row.pointId) || !validPublicId(row.recipientId) || row.kind !== "Potable" ||
      !["Draft", "Confirmed", "Issued", "PartiallyReturned", "Returned", "Cancelled"].includes(row.state) || typeof row.scheduledAt !== "string" ||
      typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1000 ||
      typeof row.returnedQuantity !== "number" || !Number.isFinite(row.returnedQuantity) || row.returnedQuantity < 0 || row.returnedQuantity > row.quantity ||
      (row.lastMovementId !== "" && !validPublicId(row.lastMovementId))) throw new ApiError(200, "некорректно_ответ", "");
    return row;
  }

  function waterStateLabel(code) {
    return new Map([["Draft", "Черновик"], ["Confirmed", "Подтвержден / резерв"], ["Issued", "Выдан"], ["PartiallyReturned", "Частично возвращен"], ["Returned", "Возвращен"], ["Cancelled", "Отменен"]]).get(code) || code;
  }

  function renderWaterSetup() {
    w.setupList.replaceChildren();
    for (const [kind, title] of [["sources", "Источники"], ["points", "Точки самовывоза"], ["recipients", "Получатели"]]) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.className = "list-heading";
      heading.id = "water-setup-" + kind;
      heading.textContent = title + " · " + water.setup[kind].length + " в выборке";
      section.append(heading);
      for (const row of water.setup[kind]) section.append(customerRecord(row.name, [row.id, "Автор создания (ID учетной записи): " + row.createdBy, "Действует · версия " + row.revision]));
      w.setupList.append(section);
      listContinuation(heading, "water/setup/" + kind + "?" + waterQuery(), () => readWaterSetup(kind), "Загрузить ещё: " + title.toLowerCase(), water.setup[kind]);
    }
    const points = water.setup.points.map((row) => [row.id, row.name]);
    [w.point, w.receiptPoint, w.orderPoint].forEach((control) => { selectOptions(control, points); });
    selectOptions(w.source, water.setup.sources.map((row) => [row.id, row.name]));
    selectOptions(w.recipient, water.setup.recipients.map((row) => [row.id, row.name]));
    if (water.pointId && water.pointId !== w.point.value) clearWaterPoint();
  }

  function renderWaterOrders() {
    waterButtons = [];
    w.ordersList.replaceChildren();
    for (const row of water.orders) {
      const point = waterSetupRef("points", row.pointId)?.name || row.pointId;
      const recipient = waterSetupRef("recipients", row.recipientId)?.name || row.recipientId;
      const record = customerRecord(waterStateLabel(row.state) + " · " + row.quantity + " м³", [
        "ID: " + row.id, "Точка: " + point, "Получатель: " + recipient, "План: " + sessionTimestamp(row.scheduledAt), "Версия записи списка: " + row.revision
      ]);
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(actionButton("Открыть / обновить заказ", () => openWaterOrder(row.id), false, waterButtons));
      record.append(actions);
      w.ordersList.append(record);
    }
    $("water-orders-empty").hidden = water.orders.length !== 0;
    $("water-orders-empty").textContent = "В текущей выборке заказов нет.";
  }

  async function readWaterScope(more = false) {
    if (!waterAreaAllowed(w.area.value)) throw new ApiError(403, "кабинет_область_запрещено", "");
    const path = "water/orders?" + waterQuery();
    const kinds = ["sources", "points", "recipients"];
    const [setup, orders] = await Promise.all([more ? water.setup : Promise.all(kinds.map(kind => requestList("water/setup/" + kind + "?" + waterQuery()))).then(rows => Object.fromEntries(kinds.map((kind, i) => [kind, rows[i]]))), requestList(path, more)]);
    if (!setup || kinds.some((kind) => !Array.isArray(setup[kind]) ||
      setup[kind].some((row) => !waterCheckedCommon(row) || !validPublicId(row.createdBy) || row.state !== "Active" || typeof row.name !== "string")) || !Array.isArray(orders)) throw new ApiError(200, "некорректно_ответ", "");
    orders.forEach(waterCheckedOrder);
    water = { ...water, scope: state.workspaceId + "|" + w.area.value, loaded: true, setup, orders };
    renderWaterSetup();
    renderWaterOrders();
    listContinuation(w.ordersList, path, () => readWaterScope(true), "Загрузить ещё заказы", orders);
  }

  async function readWaterSetup(kind) {
    if (!waterReady() || !["sources", "points", "recipients"].includes(kind)) throw new ApiError(403, "кабинет_область_запрещено", "");
    const rows = await requestList("water/setup/" + kind + "?" + waterQuery(), true);
    if (rows.some(row => !waterCheckedCommon(row) || !validPublicId(row.createdBy) || row.state !== "Active" || typeof row.name !== "string")) throw new ApiError(200, "некорректно_ответ", "");
    water.setup[kind] = rows;
    renderWaterSetup();
  }

  function waterLegalActions() {
    const item = water.detail;
    if (!item || !waterReady()) return [];
    if (item.state === "Draft") return [["confirm", "Подтвердить и зарезервировать"], ["cancel", "Отменить черновик без движения запаса"]];
    if (item.state === "Confirmed") return [["issue", "Выдать зарезервированную воду"], ["cancel", "Отменить и освободить резерв"]];
    if (["Issued", "PartiallyReturned"].includes(item.state) && item.returnedQuantity < item.quantity) return [["return", "Вернуть часть или весь остаток выданного"]];
    return [];
  }

  function renderWaterAction() {
    const allowed = waterLegalActions();
    selectOptions(w.action, allowed);
    w.actionForm.hidden = !allowed.length;
    $("water-return-fields").hidden = w.action.value !== "return";
    $("water-order-action-note").textContent = water.detail ? "Актуальная версия: " + water.detail.revision + ". Выдано по заказу: " +
      (["Issued", "PartiallyReturned", "Returned"].includes(water.detail.state) ? water.detail.quantity : 0) + " м³; возвращено: " + water.detail.returnedQuantity +
      " м³. Выдачу нельзя отменить; доступен возврат в пределах выданного объёма." : "";
  }

  function renderWaterOrder(item) {
    clearWaterDetail();
    water.detail = item;
    for (const [title, text] of [["ID заказа", item.id], ["Состояние", item.state + " · " + waterStateLabel(item.state)], ["Актуальная версия", item.revision],
      ["Точка", (waterSetupRef("points", item.pointId)?.name || "") + " · " + item.pointId], ["Получатель", (waterSetupRef("recipients", item.recipientId)?.name || "") + " · " + item.recipientId],
      ["Количество, м³", item.quantity], ["Возвращено, м³", item.returnedQuantity], ["Плановое время", sessionTimestamp(item.scheduledAt)],
      ["Последнее движение", item.lastMovementId || "Нет · Draft не создает резерв"], ["Создано", sessionTimestamp(item.createdAt)], ["Обновлено", sessionTimestamp(item.updatedAt)]]) {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = title;
      value.textContent = String(text);
      group.append(term, value);
      w.orderDetail.append(group);
    }
    $("water-order-detail-empty").hidden = true;
    renderWaterAction();
  }

  async function readWaterOrder(id) {
    const current = waterCheckedOrder(await request("water/orders/" + encodeURIComponent(id)));
    if (current.id !== id) throw new ApiError(200, "некорректно_ответ", "");
    renderWaterOrder(current);
  }

  function waterSigned(value) { return (value > 0 ? "+" : "") + value.toFixed(3); }

  async function readWaterPoint(pointId, more = false) {
    if (!waterReady() || !waterSetupRef("points", pointId)) throw new ApiError(404, "кабинет_вода_не_найдено", "");
    const path = "water/movements?" + waterQuery(pointId);
    const [balance, movements] = await Promise.all([request("water/balances?" + waterQuery(pointId)), requestList(path, more)]);
    const bucket = (row) => row && row.workspaceId === state.workspaceId && row.areaId === w.area.value && row.pointId === pointId && row.kind === "Potable";
    if (!bucket(balance) || balance.unit !== "m3" || [balance.stock, balance.reserved, balance.available].some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
      !Array.isArray(movements) || movements.some((row) => !bucket(row) || !waterCheckedCommon(row) ||
        !["Seed", "Receipt", "Reserve", "Issue", "Cancel", "Return"].includes(row.operation) || typeof row.basis !== "string" || typeof row.occurredAt !== "string" ||
        typeof row.orderState !== "string" || !Number.isSafeInteger(row.orderRevision) || typeof row.returnedQuantity !== "number" || !Number.isFinite(row.returnedQuantity) ||
        [row.quantity, row.stockDelta, row.reservedDelta, row.availableDelta].some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
        [row.sourceId, row.recipientId, row.orderId].some((value) => value !== "" && !validPublicId(value)))) throw new ApiError(200, "некорректно_ответ", "");
    water = { ...water, pointId, balances: balance, movements };
    w.balances.replaceChildren();
    for (const [field, title] of [["stock", "Физический запас, м³"], ["reserved", "Зарезервировано, м³"], ["available", "Доступно, м³"]]) {
      const card = document.createElement("div");
      card.className = "water-balance";
      const heading = document.createElement("h3");
      const amount = document.createElement("strong");
      heading.textContent = title;
      amount.textContent = balance[field].toFixed(3);
      card.append(heading, amount);
      w.balances.append(card);
    }
    $("water-balances-empty").hidden = true;
    w.movements.replaceChildren();
    for (const row of movements) {
      const record = customerRecord(row.operation + " · " + row.quantity + " м³", [
        "ID движения: " + row.id, "Дата проведения: " + sessionTimestamp(row.createdAt), "Учетная запись: " + row.createdBy, "Версия записи документа: " + row.revision, "Фактическое время: " + sessionTimestamp(row.occurredAt),
        "Источник: " + (row.sourceId || "не применяется"), "Точка: " + row.pointId, "Получатель: " + (row.recipientId || "не применяется"), "Заказ: " + (row.orderId || "не применяется"),
        "Основание: " + row.basis, "Снимок заказа при движении: " + (row.orderState ? row.orderState + " · версия " + row.orderRevision + " · возвращено " + row.returnedQuantity + " м³" : "нет связанного заказа")
      ]);
      const deltas = document.createElement("div");
      deltas.className = "water-deltas";
      for (const [field, title] of [["stockDelta", "Δ запас"], ["reservedDelta", "Δ резерв"], ["availableDelta", "Δ доступно"]]) {
        const tag = document.createElement("span");
        tag.className = "water-delta";
        tag.textContent = title + " " + waterSigned(row[field]) + " м³";
        deltas.append(tag);
      }
      record.append(deltas);
      w.movements.append(record);
    }
    $("water-movements-empty").hidden = movements.length !== 0;
    $("water-movements-empty").textContent = "Сервер не вернул проведённых движений точки в текущей выборке.";
    listContinuation(w.movements, path, () => readWaterPoint(pointId, true), "Загрузить предыдущие движения", movements);
  }

  function waterFailure(error) {
    if (error.status === 403 || (error.status === 404 && error.code === "кабинет_вода_не_найдено")) resetWater();
    else if (["кабинет_вода_редакция_конфликт", "кабинет_вода_заказ_состояние_конфликт"].includes(error.code)) {
      water.stale = true;
      $("water-order-action-note").textContent = "Карточка устарела. Откройте / обновите заказ из списка перед новым действием. Автоматического повтора не было.";
    }
    handleError(error);
  }

  async function openWaterOrder(id) {
    if (busy || !waterReady() || !water.orders.some((row) => row.id === id)) return;
    clearNotice();
    setBusy(true);
    clearWaterDetail();
    try { await readWaterOrder(id); }
    catch (error) { waterFailure(error); }
    finally { setBusy(false); }
  }

  function waterText(value, max) {
    try { return lifecycleText(value, max); }
    catch { throw new ApiError(400, "кабинет_вода_некорректно_поле", ""); }
  }
  function waterQuantity(value) {
    if (typeof value !== "string" || !/^\d+(?:\.\d{1,3})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1000) throw new ApiError(400, "кабинет_вода_некорректно_количество", "");
    return Number(value);
  }
  function waterUTC(value) {
    try {
      const utc = meterUTC(value);
      const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/).slice(1).map((part) => Number(part || 0));
      const date = new Date(value);
      const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
      if (parts.some((part, index) => part !== actual[index]) || date.getUTCFullYear() < 1 || utc === "0001-01-01T00:00:00Z") throw new Error("Некорректное календарное время");
      return utc;
    }
    catch { throw new ApiError(400, "кабинет_вода_некорректно_даты", ""); }
  }
  function waterRef(kind, value) {
    if (!waterSetupRef(kind, value)) throw new ApiError(400, "кабинет_вода_связь_конфликт", "");
    return value;
  }

  async function waterMutation(path, payload, pointId = "", createOrder = false) {
    let key;
    try { key = creationKey("water:" + path, { path, payload }); }
    catch (error) { handleError(error); return; }
    const previousOrderId = water.detail?.id || "";
    clearNotice();
    setBusy(true);
    let confirmed = false;
    try {
      const result = await request(path, { method: "POST", headers: { "Idempotency-Key": key }, body: payload });
      if (!waterCheckedCommon(result)) throw new ApiError(200, "некорректно_ответ", "");
      const orderId = createOrder ? result.id : previousOrderId;
      confirmed = true;
      clearWaterDetail();
      clearWaterPoint();
      await readWaterScope();
      if (orderId) await readWaterOrder(orderId);
      if (pointId && waterSetupRef("points", pointId)) {
        w.point.value = pointId;
        await readWaterPoint(pointId);
      }
      showNotice("Операция выполнена. Данные обновлены.");
    } catch (error) {
      waterFailure(error);
      if (confirmed && state.me) showNotice("Команда подтверждена, но перечитывание данных не завершено. Загрузите справочники и актуальный заказ. " + errorMessage(error), true);
    } finally { setBusy(false); }
  }

  function dispatchOwner() {
    return !!(isOwner() && selectedWorkspace()?.state === "Active" && roleMemberships().some((row) =>
      row.workspaceId === state.workspaceId && row.accountId === state.me.accountId && row.role === "WorkspaceOwner" &&
      row.areaScope === "All" && !row.areaId && currentMembership(row)));
  }

  function dispatchAreaAllowed(areaId) {
    return !!(state.me && selectedWorkspace()?.state === "Active" && state.areas.some((area) =>
      area.id === areaId && area.workspaceId === state.workspaceId && area.state === "Active") && roleMemberships().some((row) =>
      row.workspaceId === state.workspaceId && row.accountId === state.me.accountId && row.role === "Dispatcher" && currentMembership(row) &&
      ((row.areaScope === "All" && !row.areaId) || (row.areaScope === "Area" && row.areaId === areaId))));
  }

  function dispatchReady() { return dispatch.loaded && dispatch.scope === state.workspaceId + "|" + d.area.value && dispatchAreaAllowed(d.area.value); }
  function dispatchTerminal(item) { return !!item && ["Rejected", "Resolved"].includes(item.state); }
  function dispatchRevision(value) { return Number.isSafeInteger(value) && value > 0 && value < 999999999999997; }
  function dispatchBad() { throw new ApiError(200, "некорректно_ответ", ""); }
  function dispatchScopeQuery() { return "workspaceId=" + encodeURIComponent(state.workspaceId) + "&areaId=" + encodeURIComponent(d.area.value); }
  function dispatchScopeBody() {
    if (!dispatchReady()) throw new ApiError(403, "кабинет_область_запрещено", "");
    return { workspaceId: state.workspaceId, areaId: d.area.value };
  }

  function clearDispatchCard(staff, preserveFileCommands = false) {
    const prefix = staff ? "staff" : "own";
    clearRequestFiles(staff, preserveFileCommands);
    dispatch[prefix] = null;
    dispatch[prefix + "Stale"] = false;
    for (const suffix of ["Detail", "Messages", "History"]) d[prefix + suffix].replaceChildren();
    if (staff) {
      [d.reason, d.staffReplyText, d.dueAt, d.triageReason, d.relationReason].forEach((input) => { input.value = ""; });
      d.action.replaceChildren();
      d.actionForm.hidden = true;
      d.staffReplyForm.hidden = true;
      d.triageForm.hidden = true;
      $("dispatch-stale-note").textContent = "";
      renderDispatchRelation();
    } else {
      d.ownReplyText.value = "";
      d.ownReopenReason.value = "";
      d.ownReplyForm.hidden = true;
      d.ownReopenForm.hidden = true;
    }
  }

  function clearDispatchIncident() {
    dispatch.incident = null;
    dispatch.incidentStale = false;
    d.incidentDetail.replaceChildren();
    d.incidentLinks.replaceChildren();
    [d.incidentUpdateForecastAt, d.incidentUpdateDescription, d.incidentReason, d.relationReason].forEach((input) => { input.value = ""; });
    d.incidentActionForm.hidden = true;
    renderDispatchRelation();
  }

  function resetDispatch() {
    dispatch = emptyDispatch();
    dispatchButtons = [];
    for (const name of ["ownList", "intakeList", "queue", "incidentsList"]) d[name].replaceChildren();
    clearDispatchCard(false);
    clearDispatchCard(true);
    clearDispatchIncident();
    for (const control of Object.values(d)) if (["input", "textarea"].includes(control.tagName.toLowerCase())) control.value = "";
    [d.intake, d.address, d.category, d.intakeSelect].forEach((select) => { select.replaceChildren(); });
    d.intakePublished.value = "false";
    d.intakeAccepting.value = "false";
    for (const name of Object.keys(pendingCreations)) if (name.startsWith("dispatch:")) delete pendingCreations[name];
    $("dispatch-own-note").textContent = "Данные ещё не загружены.";
  }

  function renderDispatchAccess() {
    resetDispatch();
    selectOptions(d.area, state.areas.filter((area) => dispatchAreaAllowed(area.id)).map((area) => [area.id, area.name]));
    selectOptions(d.intakeArea, state.areas.filter((area) => area.workspaceId === state.workspaceId && area.state === "Active").map((area) => [area.id, area.name]));
    $("dispatch-owner-note").textContent = dispatchOwner() ? "Приёмные настраивает владелец рабочего пространства." :
      "Приёмные настраивает владелец рабочего пространства.";
    $("dispatch-staff-note").textContent = d.area.children.length ? "Выберите участок для работы с обращениями." :
      "Нет доступа к диспетчерской. Обратитесь к владельцу рабочей области.";
  }

  function dispatchLegalActions() {
    if (!dispatch.staff || !dispatchReady() || dispatch.staffStale) return [];
    return ({ Submitted: [["accept", "Принять"], ["reject", "Отклонить"], ["ask-info", "Запросить сведения"]],
      Accepted: [["reject", "Отклонить"], ["ask-info", "Запросить сведения"], ["resolve", "Завершить"]],
      AwaitingInfo: [], Rejected: [["reopen", "Открыть новый этап и принять"]], Resolved: [["reopen", "Открыть новый этап и принять"]] })[dispatch.staff.state] || [];
  }

  function dispatchRelationActions() {
    const item = dispatch.staff, incident = dispatch.incident;
    if (!dispatchReady() || !item || !incident || dispatch.staffStale || dispatch.incidentStale) return [];
    if (item.incidentId === incident.id) return [["unlink", "Снять существующую связь"]];
    if (!item.incidentId && incident.state === "Open" && !dispatchTerminal(item)) return [["link", "Связать открытую заявку с инцидентом"]];
    return [];
  }

  function setDispatchBusy(value) {
    const signed = !!state.me, staff = dispatchReady(), owner = dispatchOwner();
    if ((dispatch.loaded && !staff) || (dispatch.ownedLoaded && !owner)) resetDispatch();
    for (const control of Object.values(d)) control.disabled = value;
    d.ownLoadButton.disabled = value || !signed;
    for (const name of ["intake", "address", "category", "title", "description", "contact", "requestButton"]) d[name].disabled = value || !signed || !dispatch.ownLoaded || !d.intake.value;
    d.ownHistoryButton.disabled = value || !signed || !dispatch.own;
    [d.ownReplyText, d.ownReplyButton].forEach((input) => { input.disabled = value || !dispatch.own || dispatch.ownStale || dispatchTerminal(dispatch.own); });
    [d.ownReopenReason, d.ownReopenButton].forEach((input) => { input.disabled = value || !dispatch.own || dispatch.ownStale || !dispatchTerminal(dispatch.own); });
    d.intakeLoadButton.disabled = value || !owner;
    for (const name of ["intakeSelect", "intakeArea", "intakeName", "intakeAddresses", "intakeCategories", "intakePublished", "intakeAccepting", "intakeButton"]) d[name].disabled = value || !owner || !dispatch.ownedLoaded || dispatch.intakeStale || !d.intakeArea.value;
    [d.area, d.state, d.loadButton].forEach((input) => { input.disabled = value || !dispatchAreaAllowed(d.area.value); });
    for (const name of ["incidentTitle", "incidentType", "incidentSeverity", "incidentStartedAt", "incidentForecastAt", "incidentDescription", "incidentCreateButton"]) d[name].disabled = value || !staff;
    for (const name of ["action", "reason", "actionButton"]) d[name].disabled = value || !staff || !dispatchLegalActions().length;
    for (const name of ["staffReplyVisibility", "staffReplyText", "staffReplyButton"]) d[name].disabled = value || !staff || !dispatch.staff || dispatch.staffStale;
    for (const name of ["priority", "dueAt", "triageReason", "triageButton"]) d[name].disabled = value || !staff || !dispatch.staff || dispatch.staffStale || dispatchTerminal(dispatch.staff);
    d.staffHistoryButton.disabled = value || !staff || !dispatch.staff;
    for (const name of ["incidentAction", "incidentUpdateSeverity", "incidentUpdateForecastAt", "incidentUpdateDescription", "incidentReason", "incidentActionButton"]) d[name].disabled = value || !staff || !dispatch.incident || dispatch.incidentStale || dispatch.incident.state !== "Open";
    for (const name of ["relationAction", "relationReason", "relationButton"]) d[name].disabled = value || !dispatchRelationActions().length;
    dispatchButtons.forEach((button) => { button.disabled = value || !signed; });
  }

  function checkedDispatchRequest(row, staff) {
    if (!row || !validPublicId(row.id) || !validPublicId(row.publicIntakeId) || !dispatchRevision(row.revision) ||
      !Number.isSafeInteger(row.stage) || row.stage < 1 || row.stage > 20 || !dispatchStates.includes(row.state) || !dispatchCategories.includes(row.category) ||
      dispatchPublicFields.some((field) => !["stage", "revision"].includes(field) && typeof row[field] !== "string")) dispatchBad();
    if (staff && (row.workspaceId !== state.workspaceId || row.areaId !== d.area.value || !validPublicId(row.requesterAccountId) ||
      (row.responsibleAccountId !== "" && !validPublicId(row.responsibleAccountId)) || (row.incidentId !== "" && !validPublicId(row.incidentId)) ||
      !dispatchPriorities.includes(row.priority) || typeof row.dueAt !== "string" || typeof row.overdue !== "boolean" ||
      !Number.isSafeInteger(row.messageCount) || row.messageCount < 0 || row.messageCount > 200 || typeof row.resumeState !== "string" || !validPublicId(row.createdBy))) dispatchBad();
    return Object.fromEntries((staff ? dispatchStaffFields : dispatchPublicFields).map((field) => [field, row[field]]));
  }

  function checkedDispatchIncident(row) {
    if (!row || !validPublicId(row.id) || row.workspaceId !== state.workspaceId || row.areaId !== d.area.value || !dispatchRevision(row.revision) ||
      !["Open", "Resolved"].includes(row.state) || !["Leak", "Supply", "Sewer", "Other"].includes(row.type) || !dispatchSeverities.includes(row.severity) ||
      !validPublicId(row.createdBy) || !validPublicId(row.responsibleAccountId) || ["title", "description", "startedAt", "forecastAt", "resolvedAt", "createdAt", "updatedAt"].some((field) => typeof row[field] !== "string")) dispatchBad();
    return row;
  }

  function checkedDispatchIntake(row, owner) {
    if (!row || !validPublicId(row.id) || !dispatchRevision(row.revision) || typeof row.name !== "string" || typeof row.updatedAt !== "string" || typeof row.accepting !== "boolean" ||
      !Array.isArray(row.addresses) || !row.addresses.length || row.addresses.length > 30 || row.addresses.some((address) => typeof address !== "string" || !address || address.length > 250) ||
      !Array.isArray(row.categories) || !row.categories.length || row.categories.length > 8 || row.categories.some((category) => !dispatchCategories.includes(category))) dispatchBad();
    if (owner && (row.workspaceId !== state.workspaceId || !validPublicId(row.defaultAreaId) || row.areaId !== row.defaultAreaId || typeof row.published !== "boolean" || !validPublicId(row.createdBy))) dispatchBad();
    return row;
  }

  function dispatchText(value, max, lines = false) {
    if (typeof value !== "string" || value.length > max) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    if (lines) value = value.replace(/\r\n?/g, "\n");
    const forbidden = lines ? /[\x00-\x09\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ud800-\udfff]/ : /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ud800-\udfff]/;
    value = value.trim();
    if (!value || forbidden.test(value)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    return value;
  }

  function dispatchUTC(value) {
    try { return waterUTC(value); } catch { throw new ApiError(400, "кабинет_диспетчерская_некорректно_даты", ""); }
  }

  function dispatchLocal(value) {
    if (!value || /^0001-/.test(value)) return "";
    const date = new Date(value.endsWith("Z") ? value : value + "Z");
    if (!Number.isFinite(date.valueOf())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function dispatchDisplay(field, value) {
    if (["acceptedAt", "resolvedAt", "createdAt", "updatedAt", "dueAt", "startedAt", "forecastAt", "changedAt"].includes(field)) return /^0001-/.test(value) ? "Не задано" : sessionTimestamp(value);
    return value === "" ? "Не указано" : String(value);
  }

  function dispatchDL(target, row, fields) {
    target.replaceChildren();
    for (const field of fields) {
      const term = document.createElement("dt"), value = document.createElement("dd");
      term.textContent = ({ id: "ID", title: "Тема", intakeName: "Приемная", address: "Адрес", category: "Категория", description: "Описание", contact: "Контакт",
        state: "Состояние", stage: "Этап", revision: "Версия записи", lastPublicReason: "Основание перехода", priority: "Приоритет", dueAt: "Срок", overdue: "Просрочено",
        incidentId: "ID внутреннего инцидента", responsibleAccountId: "Ответственный", requesterAccountId: "Заявитель", startedAt: "Начало", forecastAt: "Прогноз", severity: "Тяжесть", type: "Тип",
        acceptedAt: "Принято", resolvedAt: "Завершено / отклонено", createdAt: "Создано", updatedAt: "Обновлено" })[field] || field;
      value.textContent = dispatchDisplay(field, row[field]);
      target.append(term, value);
    }
  }

  function renderDispatchRows(target, rows, staff) {
    target.replaceChildren();
    for (const row of rows) {
      const record = customerRecord(row.title, [row.state + " · этап " + row.stage + " · версия " + row.revision, row.address, row.intakeName, row.id]);
      record.append(actionButton(staff ? "Открыть служебную заявку" : "Открыть мою заявку", () => dispatchRun(() => readDispatchRequest(row.id, staff)), false, dispatchButtons));
      target.append(record);
    }
    if (!rows.length) target.textContent = "Сервер не вернул заявок в текущей выборке (до 100).";
  }

  function renderDispatchIntakeChoices() {
    const selected = dispatch.publicIntakes.find((row) => row.id === d.intake.value && row.accepting);
    selectOptions(d.address, selected ? selected.addresses.map((address) => [address, address]) : []);
    selectOptions(d.category, selected ? selected.categories.map((category) => [category, category]) : []);
  }

  async function readDispatchOwn() {
    if (!state.me) return;
    clearDispatchCard(false);
    [d.title, d.description, d.contact].forEach((input) => { input.value = ""; });
    const [intakes, rows] = await Promise.all([request("dispatch/public-intakes"), request("my/requests")]);
    if (!Array.isArray(intakes) || intakes.length > 100 || !Array.isArray(rows) || rows.length > 100) dispatchBad();
    intakes.forEach((row) => checkedDispatchIntake(row, false));
    const ownRows = rows.map((row) => checkedDispatchRequest(row, false));
    dispatch.publicIntakes = intakes;
    dispatch.ownRows = ownRows;
    dispatch.ownLoaded = true;
    selectOptions(d.intake, intakes.filter((row) => row.accepting).map((row) => [row.id, row.name]));
    renderDispatchIntakeChoices();
    renderDispatchRows(d.ownList, ownRows, false);
    $("dispatch-own-note").textContent = "Приёмные и обращения загружены. Завершённые обращения остаются в вашем списке.";
  }

  async function readDispatchOwned() {
    if (!dispatchOwner()) throw new ApiError(403, "кабинет_пространство_запрещено", "");
    const rows = await request("dispatch/intakes?workspaceId=" + encodeURIComponent(state.workspaceId));
    if (!Array.isArray(rows) || rows.length > 100) dispatchBad();
    rows.forEach((row) => checkedDispatchIntake(row, true));
    dispatch.owned = rows;
    dispatch.ownedLoaded = true;
    dispatch.intakeStale = false;
    d.intakeList.replaceChildren();
    for (const row of rows) d.intakeList.append(customerRecord(row.name, [row.id, "Область " + row.defaultAreaId + " · версия " + row.revision,
      (row.published ? "Видна вошедшим" : "Не опубликована") + " · " + (row.accepting ? "Принимает" : "Закрыта")]));
    selectOptions(d.intakeSelect, [["new", "Новая приемная"], ...rows.map((row) => [row.id, row.name + " · r" + row.revision])]);
    fillDispatchIntake();
  }

  function fillDispatchIntake() {
    const item = dispatch.owned.find((row) => row.id === d.intakeSelect.value);
    dispatch.intakeEditing = item || null;
    dispatch.intakeStale = false;
    d.intakeName.value = item?.name || "";
    d.intakeAddresses.value = item?.addresses.join("\n") || "";
    d.intakeCategories.value = item?.categories.join(",") || "";
    d.intakePublished.value = String(item?.published || false);
    d.intakeAccepting.value = String(item?.accepting || false);
    if (item) d.intakeArea.value = item.defaultAreaId;
  }

  async function readDispatchStaff() {
    if (!dispatchAreaAllowed(d.area.value)) throw new ApiError(403, "кабинет_область_запрещено", "");
    if (d.state.value && !dispatchStates.includes(d.state.value)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_состояние", "");
    const suffix = d.state.value ? "&state=" + encodeURIComponent(d.state.value) : "";
    const [queue, incidents] = await Promise.all([request("dispatch/requests?" + dispatchScopeQuery() + suffix), request("dispatch/incidents?" + dispatchScopeQuery())]);
    if (!Array.isArray(queue) || queue.length > 100 || !Array.isArray(incidents) || incidents.length > 100) dispatchBad();
    const checkedQueue = queue.map((row) => checkedDispatchRequest(row, true));
    incidents.forEach(checkedDispatchIncident);
    dispatch.queue = checkedQueue;
    dispatch.incidents = incidents;
    dispatch.loaded = true;
    dispatch.scope = state.workspaceId + "|" + d.area.value;
    renderDispatchRows(d.queue, checkedQueue, true);
    d.incidentsList.replaceChildren();
    for (const row of incidents) {
      const record = customerRecord(row.title, [row.state + " · " + row.severity + " · версия " + row.revision, row.id]);
      record.append(actionButton("Открыть инцидент", () => dispatchRun(() => readDispatchIncident(row.id)), false, dispatchButtons));
      d.incidentsList.append(record);
    }
    if (!incidents.length) d.incidentsList.textContent = "Сервер не вернул инцидентов в текущей выборке.";
  }

  function checkedDispatchMessages(rows, staff) {
    if (!Array.isArray(rows) || rows.length > 200) dispatchBad();
    for (const row of rows) if (!row || !validPublicId(row.id) || typeof row.text !== "string" || row.text.length > 4000 ||
      !["Requester", "Dispatcher"].includes(row.authorLabel) || typeof row.createdAt !== "string" || (!staff && row.visibility !== undefined && row.visibility !== "Public") ||
      (staff && (!["Public", "Internal"].includes(row.visibility) || !validPublicId(row.actorAccountId)))) dispatchBad();
    return rows;
  }

  function renderDispatchMessages(target, rows, staff) {
    target.replaceChildren();
    for (const row of rows) {
      const record = customerRecord((staff ? (row.visibility === "Internal" ? "Внутренняя заметка · " : "Заявителю · ") : "") + row.authorLabel,
        [sessionTimestamp(row.createdAt), row.text]);
      if (staff && row.visibility === "Internal") record.className += " dispatch-message-internal";
      target.append(record);
    }
    if (!rows.length) target.textContent = "Переписка еще не начата.";
  }

  async function readDispatchRequest(id, staff) {
    if (!state.me || (staff && !dispatchReady())) throw new ApiError(403, "кабинет_область_запрещено", "");
    clearDispatchCard(staff, fileParent(staff)?.id === id || requestFiles[fileKind(staff)].parentId === id);
    requestFiles[fileKind(staff)].parentId = id;
    const result = await request((staff ? "dispatch/requests/" : "my/requests/") + encodeURIComponent(id));
    const item = checkedDispatchRequest(result?.request, staff);
    if (item.id !== id) dispatchBad();
    const messages = checkedDispatchMessages(result.messages, staff);
    dispatch[staff ? "staff" : "own"] = item;
    dispatchDL(staff ? d.staffDetail : d.ownDetail, item, staff ? dispatchStaffFields : dispatchPublicFields);
    renderDispatchMessages(staff ? d.staffMessages : d.ownMessages, messages, staff);
    if (staff) {
      selectOptions(d.action, dispatchLegalActions());
      d.actionForm.hidden = !dispatchLegalActions().length;
      d.staffReplyForm.hidden = false;
      selectOptions(d.staffReplyVisibility, dispatchTerminal(item) ? [["Internal", "Только внутренняя заметка"]] : [["Public", "Ответ заявителю"], ["Internal", "Только внутренняя заметка"]]);
      d.triageForm.hidden = dispatchTerminal(item);
      d.priority.value = item.priority;
      d.dueAt.value = dispatchLocal(item.dueAt);
      renderDispatchRelation();
    } else {
      d.ownReplyForm.hidden = dispatchTerminal(item);
      d.ownReopenForm.hidden = !dispatchTerminal(item);
    }
    filePanels[staff ? "staff" : "own"].panel.hidden = false;
    filePanels[staff ? "staff" : "own"].note.textContent = "Вложения этой заявки еще не загружены. Файлы не открываются автоматически.";
  }

  function renderDispatchRelation() {
    selectOptions(d.relationAction, dispatchRelationActions());
    d.relationForm.hidden = !dispatchRelationActions().length;
    $("dispatch-relation-note").textContent = dispatch.staff && dispatch.incident ? "Заявка " + dispatch.staff.id + " · r" + dispatch.staff.revision +
      "; инцидент " + dispatch.incident.id + " · r" + dispatch.incident.revision + ". Связь не меняет заявителя, маршрут или доступ." : "Откройте служебную заявку и инцидент одной области.";
  }

  async function readDispatchIncident(id) {
    if (!dispatchReady()) throw new ApiError(403, "кабинет_область_запрещено", "");
    clearDispatchIncident();
    const result = await request("dispatch/incidents/" + encodeURIComponent(id));
    const item = checkedDispatchIncident(result?.incident);
    if (item.id !== id || !Array.isArray(result.requests) || result.requests.length > 100) dispatchBad();
    const rows = result.requests.map((row) => checkedDispatchRequest(row, true));
    if (rows.some((row) => row.incidentId !== item.id)) dispatchBad();
    dispatch.incident = item;
    dispatchDL(d.incidentDetail, item, ["id", "title", "state", "revision", "type", "severity", "startedAt", "forecastAt", "resolvedAt", "description", "responsibleAccountId", "createdAt", "updatedAt"]);
    for (const row of rows) d.incidentLinks.append(customerRecord("Связанная заявка: " + row.title, [row.state + " · r" + row.revision, row.id]));
    d.incidentActionForm.hidden = item.state !== "Open";
    d.incidentUpdateSeverity.value = item.severity;
    d.incidentUpdateForecastAt.value = dispatchLocal(item.forecastAt);
    d.incidentUpdateDescription.value = item.description;
    renderDispatchRelation();
  }

  async function readDispatchHistory(staff) {
    const item = dispatch[staff ? "staff" : "own"];
    if (!item || (staff && !dispatchReady())) return;
    const target = staff ? d.staffHistory : d.ownHistory;
    target.replaceChildren();
    const rows = await request((staff ? "dispatch/requests/" : "my/requests/") + encodeURIComponent(item.id) + "/history");
    if (!Array.isArray(rows) || rows.length > 100) dispatchBad();
    const snapshots = [];
    for (const event of rows) {
      if (!event || !dispatchRevision(event.revision) || typeof event.operation !== "string" || typeof event.reason !== "string" || typeof event.changedAt !== "string" ||
        (staff ? (!["Public", "Internal"].includes(event.visibility) || !validPublicId(event.actorAccountId)) :
          ((event.visibility !== undefined && event.visibility !== "Public") || !["Requester", "Dispatcher"].includes(event.authorLabel)))) dispatchBad();
      const checked = {};
      for (const key of ["before", "after"]) {
        const snapshot = event[key];
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) dispatchBad();
        checked[key] = Object.keys(snapshot).length ? checkedDispatchRequest(snapshot, staff) : {};
        if (Object.keys(checked[key]).length && checked[key].id !== item.id) dispatchBad();
      }
      if (checked.after.revision !== event.revision || (Object.keys(checked.before).length && checked.before.revision + 1 !== event.revision)) dispatchBad();
      snapshots.push({ event, checked });
    }
    for (const { event, checked } of snapshots) {
      const record = customerRecord(event.operation + " · r" + event.revision, [sessionTimestamp(event.changedAt), event.reason,
        staff ? event.visibility + " · " + event.actorAccountId : event.authorLabel]);
      const columns = document.createElement("div");
      columns.className = "registry-history-snapshots";
      for (const [key, label] of [["before", "До изменения"], ["after", "После изменения"]]) {
        const details = document.createElement("details"), summary = document.createElement("summary"), list = document.createElement("dl");
        summary.textContent = label;
        list.className = "registry-detail-list";
        dispatchDL(list, checked[key], Object.keys(checked[key]).length ? (staff ? dispatchStaffFields : dispatchPublicFields) : []);
        details.append(summary, list);
        columns.append(details);
      }
      record.append(columns);
      target.append(record);
    }
    if (!rows.length) target.textContent = "Сервер не вернул доступных событий. Внутренние события не входят в личную историю.";
  }

  function fileKind(staff) { return staff ? "staff" : "own"; }
  function fileParent(staff) { return dispatch[fileKind(staff)]; }
  function filesAllowed(staff) {
    return !!state.me && !!fileParent(staff) && !dispatch[fileKind(staff) + "Stale"] && (!staff || dispatchReady());
  }
  function filePath(id, staff) { return (staff ? "dispatch" : "my") + "/request-files/" + encodeURIComponent(id); }
  function filesPath(staff) { return (staff ? "dispatch" : "my") + "/requests/" + encodeURIComponent(fileParent(staff).id) + "/files"; }
  function filesWritable(staff, visibility) { return filesAllowed(staff) && (visibility === "Internal" ? staff : visibility === "Public" && !dispatchTerminal(fileParent(staff))); }
  function fileReplaceAllowed(staff) {
    const view = requestFiles[fileKind(staff)], row = view.detail?.file;
    return !!row && !view.stale && (row.version < 100 || view.unresolved?.fileId === row.id) && filesWritable(staff, row.visibility) &&
      (staff ? row.uploaderAccountId === state.me.accountId : row.authorLabel === "Requester");
  }
  function clearRequestFiles(staff, preserveCommands = false) {
    const kind = fileKind(staff), panel = filePanels[kind];
    const previous = requestFiles[kind];
    if (fileTask?.kind === kind) { fileTask.cancelled = true; fileTask.controller.abort(); }
    requestFiles[kind] = emptyRequestFiles();
    if (preserveCommands) Object.assign(requestFiles[kind], { parentId: previous.parentId, receipt: previous.receipt, stale: previous.stale, unresolved: previous.unresolved });
    panel.list.replaceChildren(); panel.detail.replaceChildren();
    panel.input.value = ""; panel.reason.value = ""; panel.visibility.value = "Public";
    panel.note.textContent = ""; panel.panel.hidden = true;
    if (!preserveCommands) for (const name of Object.keys(pendingCreations)) if (name.startsWith("files:" + kind + ":")) delete pendingCreations[name];
  }
  function setRequestFilesBusy(value) {
    for (const staff of [false, true]) {
      const kind = fileKind(staff), panel = filePanels[kind], allowed = filesAllowed(staff);
      const write = filesWritable(staff, panel.visibility.value);
      panel.panel.hidden = !fileParent(staff);
      panel.load.disabled = value || !allowed;
      panel.input.disabled = value || !allowed || (!write && !fileReplaceAllowed(staff));
      panel.visibility.disabled = value || !allowed || !staff;
      panel.reason.disabled = value || !fileReplaceAllowed(staff);
      panel.upload.disabled = value || !write || requestFiles[kind].stale;
      panel.replace.disabled = value || !fileReplaceAllowed(staff);
      panel.cancel.disabled = !allowed || (value && fileTask?.kind !== kind);
      [...requestFiles[kind].buttons, ...requestFiles[kind].detailButtons].forEach((button) => { button.disabled = value || !allowed; });
    }
  }
  function validFileName(name) {
    return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_. -]{0,119}$/.test(name) && name.trim() === name &&
      !name.endsWith(".") && !name.includes("..") && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
  }
  function fileMime(name) { return fileTypes.get(name.split(".").at(-1).toLowerCase()) || ""; }
  function checkedFile(row, staff) {
    const fields = staff ? [...fileMetadataFields, "workspaceId", "areaId", "uploaderAccountId", "createdBy"] : fileMetadataFields;
    if (!row || typeof row !== "object" || Object.keys(row).length !== fields.length || Object.keys(row).some((name) => !fields.includes(name)) ||
      ["id", "parentRequestId", "revisionId"].some((name) => !validPublicId(row[name])) || row.parentRequestId !== fileParent(staff)?.id ||
      !Number.isSafeInteger(row.version) || row.version < 1 || row.version > 100 || !Number.isSafeInteger(row.byteCount) || row.byteCount < 1 || row.byteCount > 5242880 ||
      !validFileName(row.filename) || fileMime(row.filename) !== row.mime || !fileTypes.has(row.filename.split(".").at(-1).toLowerCase()) ||
      !["Requester", "Dispatcher"].includes(row.authorLabel) || !["Public", "Internal"].includes(row.visibility) || (!staff && row.visibility !== "Public") ||
      typeof row.sha256 !== "string" || !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(row.sha256) || typeof row.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row.createdAt) || !Number.isFinite(Date.parse(row.createdAt + "Z")) ||
      new Date(row.createdAt + "Z").toISOString().slice(0, 19) !== row.createdAt ||
      typeof row.reason !== "string" || !row.reason || row.reason.length > 250 ||
      (row.version === 1 ? row.previousRevisionId !== "" : !validPublicId(row.previousRevisionId)) ||
      (staff && (row.workspaceId !== state.workspaceId || row.areaId !== d.area.value || !validPublicId(row.uploaderAccountId) || !validPublicId(row.createdBy)))) dispatchBad();
    return Object.fromEntries(fields.map((name) => [name, row[name]]));
  }
  function assertFileTask(task) {
    if (fileTask !== task || task.cancelled || task.controller.signal.aborted || !filesAllowed(task.staff) || fileParent(task.staff).id !== task.parentId) throw new Error("файл_операция_отменено");
  }
  async function filesRun(staff, operation) {
    if (busy || !filesAllowed(staff)) return;
    const task = { staff, kind: fileKind(staff), parentId: fileParent(staff).id, controller: new AbortController(), cancelled: false, sent: false, confirmed: null };
    fileTask = task;
    clearNotice(); setBusy(true);
    try { await operation(task); }
    catch (error) {
      const wasCancelled = task.cancelled;
      const sameParent = fileParent(staff)?.id === task.parentId;
      if (wasCancelled && !sameParent) return;
      if (error.status === 403 || (error.status === 404 && error.code === "кабинет_диспетчерская_не_найдено")) {
        resetDispatch(); handleError(error); return;
      }
      if (error.status === 401 || noNativeSession(error)) { handleError(error); return; }
      const conflict = ["кабинет_файл_редакция_конфликт", "кабинет_диспетчерская_состояние_конфликт"].includes(error.code);
      const uncertain = task.sent && !task.confirmed && (wasCancelled || !error.status || error.code === "некорректно_ответ");
      const receipt = task.confirmed || requestFiles[task.kind].receipt;
      if (error.status === 404 || error.code === "некорректно_ответ") clearRequestFiles(staff, true);
      if (task.command) {
        if (uncertain || task.confirmed) requestFiles[task.kind].unresolved = task.command;
        else if (error.status >= 400 && requestFiles[task.kind].unresolved?.commandId === task.command.commandId) requestFiles[task.kind].unresolved = null;
      }
      if (conflict || uncertain) dispatch[task.kind + "Stale"] = true;
      if (conflict || uncertain || receipt) requestFiles[task.kind].stale = true;
      handleError(error instanceof ApiError ? error : new ApiError(0, "сеть_ошибка", ""));
      if (receipt) {
        requestFiles[task.kind].receipt = receipt;
        const message = "Файл подтверждён сервером: " + receipt.filename + ", v" + receipt.version +
          ". Не удалось загрузить текущую версию. Обновите вложения.";
        filePanels[task.kind].note.textContent = message; showNotice(message, true);
      } else if (conflict || uncertain) {
        const message = uncertain ? "Результат загрузки неизвестен. Откройте заявку заново и обновите вложения. При необходимости повторите загрузку того же файла." :
          "Состояние или версия изменились. Откройте заявку заново, затем актуальные версии файла. Загрузка только списка не снимает блокировку.";
        filePanels[task.kind].note.textContent = message; showNotice(message, true);
      } else if (wasCancelled) showNotice("Чтение отменено; выбор файла и незавершенные поля очищены.");
    } finally {
      if (fileTask === task) fileTask = null;
      setBusy(false);
    }
  }
  async function readRequestFiles(staff, task) {
    const rows = await request(filesPath(staff), { signal: task.controller.signal });
    assertFileTask(task);
    if (!Array.isArray(rows) || rows.length > 100) dispatchBad();
    const checked = rows.map((row) => checkedFile(row, staff));
    if (new Set(checked.map((row) => row.id)).size !== checked.length) dispatchBad();
    const view = requestFiles[fileKind(staff)], panel = filePanels[fileKind(staff)];
    view.loaded = true; view.rows = checked; view.buttons = [];
    if (!view.receipt) view.stale = false;
    panel.list.replaceChildren();
    for (const row of checked) {
      const record = customerRecord(row.filename, [row.visibility + " · v" + row.version + " · " + row.byteCount + " байт", row.authorLabel + " · " + sessionTimestamp(row.createdAt)]);
      record.append(actionButton("Открыть версии файла", () => filesRun(staff, (current) => readRequestFile(row.id, staff, current)), false, view.buttons));
      panel.list.append(record);
    }
    panel.note.textContent = checked.length ? "Загружена последняя выборка: " + checked.length + " файлов (до 100). Public — не анонимная ссылка." : "Вложений, доступных текущей учетной записи, нет.";
  }
  async function readRequestFile(id, staff, task) {
    const view = requestFiles[fileKind(staff)], panel = filePanels[fileKind(staff)];
    view.detail = null; view.detailButtons = []; panel.detail.replaceChildren(); panel.reason.value = "";
    const result = await request(filePath(id, staff), { signal: task.controller.signal });
    assertFileTask(task);
    if (!result || Object.keys(result).length !== 2 || !Array.isArray(result.versions) || !result.versions.length || result.versions.length > 100) dispatchBad();
    const file = checkedFile(result.file, staff), versions = result.versions.map((row) => checkedFile(row, staff));
    if (file.id !== id || file.version !== versions.length || versions.some((row, index) => row.id !== id || row.version !== index + 1 || row.previousRevisionId !== (index ? versions[index - 1].revisionId : "") || row.visibility !== file.visibility || row.authorLabel !== file.authorLabel || (staff && row.uploaderAccountId !== file.uploaderAccountId)) ||
      JSON.stringify(file) !== JSON.stringify(versions.at(-1)) || new Set(versions.map((row) => row.revisionId)).size !== versions.length) dispatchBad();
    view.detail = { file, versions };
    if (!view.receipt || view.receipt.id === file.id) {
      view.stale = false;
      if (view.receipt && view.unresolved?.commandId === view.receipt.commandId) view.unresolved = null;
      view.receipt = null;
    }
    const heading = document.createElement("h4"); heading.textContent = "Версии: " + file.filename + " · текущая v" + file.version; panel.detail.append(heading);
    for (const row of [...versions].reverse()) {
      const record = customerRecord("v" + row.version + " · " + row.filename, [row.visibility + " · " + row.byteCount + " байт · " + row.mime,
        "SHA256 (Base64): " + row.sha256, sessionTimestamp(row.createdAt) + " · " + row.authorLabel, "Основание: " + row.reason]);
      record.append(actionButton("Скачать версию " + row.version, () => filesRun(staff, (current) => downloadRequestFile(row, staff, current, false)), false, view.detailButtons));
      panel.detail.append(record);
    }
    panel.detail.append(actionButton("Скачать текущую версию", () => filesRun(staff, (current) => downloadRequestFile(file, staff, current, true)), false, view.detailButtons));
    panel.note.textContent = "Выбран файл " + file.filename + ", head v" + file.version + ". Замена создаёт новую неизменяемую версию; исходные версии остаются.";
    if (view.receipt) panel.note.textContent += " Подтверждён другой файл: " + view.receipt.filename + ". Обновите вложения для проверки его head; запись пока заблокирована.";
  }
  function bytesBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }
  async function fileDigest(bytes) {
    if (!globalThis.crypto?.subtle) throw new ApiError(0, "кабинет_шифрование_недоступно", "");
    return bytesBase64(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
  }
  async function uploadRequestFile(staff, replace, task) {
    const kind = fileKind(staff), panel = filePanels[kind], view = requestFiles[kind];
    const input = panel.input.files;
    if (!input || input.length !== 1) throw new ApiError(400, "кабинет_файл_некорректно_поле", "");
    const selected = input[0], mime = typeof selected.name === "string" ? fileMime(selected.name) : "";
    if (!validFileName(selected.name)) throw new ApiError(400, "кабинет_файл_некорректно_имя_файла", "");
    if (!mime) throw new ApiError(415, "кабинет_файл_некорректно_тип", "");
    if (!Number.isSafeInteger(selected.size) || selected.size < 1 || selected.size > 5242880) throw new ApiError(413, "кабинет_файл_некорректно_размер", "");
    const visibility = panel.visibility.value;
    if (replace ? !fileReplaceAllowed(staff) : !filesWritable(staff, visibility) || view.stale) return;
    const reason = replace ? panel.reason.value : "";
    if (replace && (typeof reason !== "string" || reason.trim() !== reason || !reason || reason.length > 250 || /[\x00-\x1f\x7f-\x9f]/.test(reason))) throw new ApiError(400, "кабинет_файл_некорректно_поле", "");
    const head = replace ? { ...view.detail.file } : null;
    const bytes = new Uint8Array(await selected.arrayBuffer());
    assertFileTask(task);
    if (bytes.length !== selected.size) throw new ApiError(413, "кабинет_файл_некорректно_размер", "");
    const sha256 = await fileDigest(bytes); assertFileTask(task);
    const path = replace ? filePath(head.id, staff) + "/versions" : filesPath(staff);
    const identity = { path, filename: selected.name, mime, byteCount: bytes.length, sha256, ...(replace ? { reason } : { visibility }) };
    const unresolved = view.unresolved;
    const retry = replace && unresolved && unresolved.fileId === head.id && Object.keys(identity).every((name) => unresolved[name] === identity[name]);
    if (replace && !retry && head.version >= 100) throw new ApiError(429, "кабинет_файл_квота_превышено", "");
    const expectedVersion = retry ? unresolved.expectedVersion : head?.version;
    const intent = { ...identity, ...(replace ? { expectedVersion } : {}) };
    const commandId = retry ? unresolved.commandId : creationKey("files:" + kind + ":" + path, intent);
    if (replace) {
      task.command = { ...intent, fileId: head.id, commandId };
      view.unresolved = null;
    }
    const payload = replace ? { expectedVersion, filename: selected.name, mime, contentBase64: bytesBase64(bytes), reason } :
      { visibility, filename: selected.name, mime, contentBase64: bytesBase64(bytes) };
    task.sent = true;
    const result = await request(path, { method: "POST", headers: { "Idempotency-Key": commandId }, body: payload, signal: task.controller.signal });
    assertFileTask(task);
    const original = checkedFile(result, staff);
    if (original.filename !== selected.name || original.mime !== mime || original.byteCount !== bytes.length || original.sha256 !== sha256 ||
      original.visibility !== (replace ? head.visibility : visibility) || original.version !== (replace ? expectedVersion + 1 : 1) ||
      original.reason !== (replace ? reason : "Initial attachment") || original.authorLabel !== (replace ? head.authorLabel : staff ? "Dispatcher" : "Requester") ||
      (replace && original.id !== head.id) || (staff && (original.uploaderAccountId !== state.me.accountId || original.createdBy !== state.me.accountId))) dispatchBad();
    task.confirmed = { id: original.id, version: original.version, filename: original.filename, commandId };
    view.receipt = task.confirmed; view.stale = true;
    panel.input.value = ""; panel.reason.value = "";
    view.detail = null; panel.detail.replaceChildren();
    await readRequestFiles(staff, task);
    await readRequestFile(original.id, staff, task);
    showNotice("Файл подтверждён, актуальный head и список перечитаны. Автоматического повтора нет.");
  }
  async function downloadRequestFile(row, staff, task, latest) {
    let objectURL = "", anchor = null;
    const controller = task.controller, timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (latest) {
        await readRequestFile(row.id, staff, task);
        row = requestFiles[fileKind(staff)].detail.file;
      }
      const path = filePath(row.id, staff) + (latest ? "/content" : "/versions/" + row.version + "/content");
      const response = await fetch(API + path, { method: "GET", headers: new Headers({ Accept: "application/octet-stream" }),
        credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      assertFileTask(task);
      if (!response.ok) {
        let data = null; try { data = await response.json(); } catch {  }
        throw new ApiError(response.status, responseErrorCode(data), typeof data?.requestId === "string" ? data.requestId : "");
      }
      const responseMime = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (responseMime !== row.mime) {
        if (latest && [...fileTypes.values()].includes(responseMime)) throw new ApiError(409, "кабинет_файл_редакция_конфликт", "");
        dispatchBad();
      }
      if (!/^attachment(?:;|$)/i.test(response.headers.get("Content-Disposition") || "") ||
        !/(?:^|,)\s*no-store(?:\s*,|$)/i.test(response.headers.get("Cache-Control") || "") ||
        (response.headers.get("X-Content-Type-Options") || "").toLowerCase() !== "nosniff") dispatchBad();
      const blob = await response.blob(); assertFileTask(task);
      if (blob.size < 1 || blob.size > 5242880) dispatchBad();
      if (blob.size !== row.byteCount) { if (latest) throw new ApiError(409, "кабинет_файл_редакция_конфликт", ""); dispatchBad(); }
      const digest = await fileDigest(new Uint8Array(await blob.arrayBuffer())); assertFileTask(task);
      if (digest !== row.sha256) { if (latest) throw new ApiError(409, "кабинет_файл_редакция_конфликт", ""); dispatchBad(); }
      objectURL = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
      anchor = document.createElement("a"); anchor.href = objectURL; anchor.download = row.filename; anchor.hidden = true;
      document.body.append(anchor); anchor.click();
      showNotice("Файл передан браузеру для скачивания. Не открывайте недоверенные файлы автоматически.");
    } catch (error) {
      if (error instanceof ApiError || task.cancelled) throw error;
      throw new ApiError(0, controller.signal.aborted ? "таймаут_ошибка" : "сеть_ошибка", "");
    } finally { clearTimeout(timeout); if (anchor) anchor.remove(); if (objectURL) URL.revokeObjectURL(objectURL); }
  }

  function dispatchFailure(error) {
    if (error.status === 403 || (error.status === 404 && error.code === "кабинет_диспетчерская_не_найдено")) resetDispatch();
    if (["кабинет_диспетчерская_редакция_конфликт", "кабинет_диспетчерская_состояние_конфликт", "кабинет_диспетчерская_связь_конфликт"].includes(error.code)) {
      dispatch.ownStale = true;
      dispatch.staffStale = true;
      dispatch.incidentStale = true;
      dispatch.intakeStale = true;
      $("dispatch-stale-note").textContent = "Карточка устарела. Откройте обе карточки заново перед следующим действием; автоматического повтора нет.";
    }
    handleError(error);
  }

  async function dispatchRun(operation) {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    try { await operation(); }
    catch (error) { dispatchFailure(error); }
    finally { setBusy(false); }
  }

  async function dispatchMutation(path, payload, kind) {
    const key = creationKey("dispatch:" + path, { path, payload });
    const ownId = dispatch.own?.id || "", staffId = dispatch.staff?.id || "", incidentId = dispatch.incident?.id || "";
    let confirmed = false;
    try {
      const result = await request(path, { method: "POST", headers: { "Idempotency-Key": key }, body: payload });
      const id = kind === "relation" ? result?.request?.id : result?.id;
      if (!validPublicId(id)) dispatchBad();
      confirmed = true;
      if (kind === "own") {
        await readDispatchOwn();
        await readDispatchRequest(path === "my/requests" ? id : ownId, false);
      } else if (kind === "intake") {
        await readDispatchOwned();
        d.intakeSelect.value = id;
        fillDispatchIntake();
      } else {
        clearDispatchCard(true);
        clearDispatchIncident();
        await readDispatchStaff();
        if (kind === "staff" && staffId) await readDispatchRequest(staffId, true);
        if (kind === "incident" && path === "dispatch/incidents") await readDispatchIncident(id);
        else if (incidentId) await readDispatchIncident(incidentId);
        if (kind !== "staff" && staffId) await readDispatchRequest(staffId, true);
      }
      showNotice("Изменение сохранено. Данные обновлены.");
    } catch (error) {
      if (confirmed) {
        dispatch.ownStale = true;
        dispatch.staffStale = true;
        dispatch.incidentStale = true;
        showNotice("Команда подтверждена, но перечитывание не завершено. Загрузите актуальные карточки. " + errorMessage(error), true);
      }
      throw error;
    }
  }

  async function loadDashboard(preferredWorkspaceId = "", initialIdentity = null) {
    dashboardLoads++;
    try {
      setBusy(true);
      invalidateHostContext();
      const ticket = ++sequence;
      packagePermissionEpoch++;
      clearPackageContext("orders");
      clearPackageContext("hydrology");
      if (preferredWorkspaceId && preferredWorkspaceId !== state.workspaceId) { clearInventoryContext(); clearWorkMaterialsContext(); }
      let me;
      try { me = initialIdentity || await request("me"); }
      catch (error) { if (ticket === sequence) { clearInventoryContext(); clearWorkMaterialsContext(); } throw error; }
      if (ticket !== sequence) return;
      try { validateIdentity(me); }
      catch (error) { clearInventoryContext(); clearWorkMaterialsContext(); throw error; }
      const sameAccount = state.me?.accountId === me.accountId && state.me?.actorId === me.actorId;
      if (!sameAccount) {
        clearInventoryContext();
        clearWorkMaterialsContext();
        resetCustomer();
        resetMeterAll();
        pendingCreations = {};
      }
      const workspaces = await requestList("workspaces");
      validateIAMRows("workspaces", workspaces);
      const own = workspaces.find((workspace) => workspace.ownerAccountId === me.accountId);
      const workspaceId = preferredWorkspaceId || (own || workspaces[0] || {}).id || "";
      if (ticket !== sequence) return;
      if (workspaceId !== state.workspaceId) { clearInventoryContext(); clearWorkMaterialsContext(); }
      const [memberships, areas, incoming] = await Promise.all([
        workspaceId ? requestList("memberships?workspaceId=" + encodeURIComponent(workspaceId)) : [],
        workspaceId ? requestList("areas?workspaceId=" + encodeURIComponent(workspaceId)) : [],
        requestList("invitations")
      ]);
      validateIAMRows("memberships", memberships, workspaceId);
      validateIAMRows("areas", areas, workspaceId);
      validateIAMRows("incoming", incoming);
      const authority = await readAuthority({ me, workspaceId, areas });
      const outgoing = authority?.owner ? await requestList("invitations?workspaceId=" + encodeURIComponent(workspaceId)) : [];
      validateIAMRows("outgoing", outgoing, workspaceId);
      if (ticket !== sequence) return;
      state = { me, workspaces, memberships, authority, workspace: authority?.workspace || null, areas, incoming, outgoing, sessions: [], sessionsLoaded: false, workspaceId };
      inventoryAccessRejected = false;
      workMaterialsAccessRejected = false;
      workOrdersAccessRejected = false;
      hydrologyAccessRejected = false;
      scheduleAuthorityExpiry();
      render();
    } finally {
      dashboardLoads--;
    }
  }

  async function finishNativeSession() {
    try {
      await request("auth/session", { method: "DELETE", headers: { IBSession: "finish" } });
    } catch (error) {
      const noNativeSession = error.status === 400 && error.code === "хттп_ошибка";
      if (error.status !== 401 && error.status !== 404 && !noNativeSession) throw error;
    }
  }

  function basicCredentials(username, password) {
    const bytes = new TextEncoder().encode(username + ":" + password);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return "Basic " + btoa(binary);
  }

  ui.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    let password = ui.password.value;
    ui.password.value = "";
    const username = ui.username.value.trim();
    if (!username || !password || username.includes(":")) {
      password = "";
      showNotice("Введите имя пользователя без двоеточия и пароль 1С.", true);
      return;
    }
    clearNotice();
    setBusy(true);
    ui.loginStatus.textContent = "Выполняется вход…";
    let authorization = "";
    try {
      await finishNativeSession();
      authorization = basicCredentials(username, password);
      password = "";
      const me = await request("auth/session", {
        method: "POST", headers: { Authorization: authorization, IBSession: "start" }, body: {}
      });
      authorization = "";
      await loadDashboard("", me);
      ui.username.value = "";
      $("main").focus();
    } catch (error) {
      handleError(error, true);
      ui.loginStatus.textContent = "Вход не завершен. Повторите попытку.";
    } finally {
      password = "";
      authorization = "";
      ui.password.value = "";
      setBusy(false);
    }
  });

  ui.refreshButton.addEventListener("click", async () => {
    if (busy) return;
    clearNotice();
    setBusy(true);
    try {
      await loadDashboard(state.workspaceId);
      showNotice("Данные обновлены из 1С.");
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  });

  function changeRegistryContext() {
    if (busy) return;
    resetRegistry();
    buildRegistryForm();
    renderRegistryAccess();
    setBusy(false);
  }

  ui.registryArea.addEventListener("change", changeRegistryContext);
  ui.registryEntity.addEventListener("change", () => {
    if (busy) return;
    ui.registrySearch.value = "";
    changeRegistryContext();
  });
  ui.registryFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !registryAreaAllowed(ui.registryArea.value) || !registrySchemas.has(ui.registryEntity.value)) return;
    clearNotice();
    setBusy(true);
    try {
      await readRegistry();
      showNotice("Выборка реестра и связанные записи загружены из 1С.");
    } catch (error) {
      if (error.status === 403) resetRegistry();
      handleError(error);
    } finally { setBusy(false); }
  });
  $("host-create-retry").addEventListener("click", async () => {
    if (!busy && hostCreateIntent) await sendHostCreation(hostCreateIntent);
  });
  $("host-create-abandon").addEventListener("click", () => {
    if (busy || !hostCreateIntent || !confirm("Сервер мог уже создать запись. Удаление данных повтора из вкладки не отменяет её. Перед новым созданием проверьте исходный раздел. Продолжить?")) return;
    clearHostCreation(); setBusy(false);
  });

  ui.registryCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !registryContextReady() || registry.uncertain || hostCreateIntent) return;
    let payload;
    try { payload = registryPayload(); }
    catch (error) { handleError(error); return; }
    let intent;
    try { intent = prepareHostCreation(registry.kind, payload, async created => {
      await readRegistry();
      renderRegistryDetail(created);
      showNotice("Запись создана. Карточка показана; текущий фильтр списка может исключать новую запись.");
    }); } catch (error) { handleError(error); return; }
    await sendHostCreation(intent);
  });

  ui.lifecycleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !registryLifecycleEditable()) return;
    let payload;
    let key;
    const kind = registry.kind;
    const id = registry.detail.id;
    const path = kind + "/" + encodeURIComponent(id) + "/actions/" + lifecycleActions.get(kind).action;
    try {
      payload = registryLifecyclePayload();
      key = creationKey("registryLifecycle", { path, payload });
    } catch (error) { handleError(error); return; }
    clearNotice();
    setBusy(true);
    let confirmed = false;
    try {
      const result = await request(path, { method: "POST", headers: { "Idempotency-Key": key }, body: payload });
      checkedRegistryRows([result], registry.workspaceId, registry.areaId);
      if (result.id !== id || result.revision !== payload.expectedRevision + 1) throw new ApiError(200, "некорректно_ответ", "");
      confirmed = true;
      resetRegistryLifecycle();
      registry.lifecycleStale = true;
      if (kind === "personal-accounts" && result.state === "Closed") {
        customer.accounts = customer.accounts.map((account) => account.id === id ? { ...account, state: "Closed" } : account);
        meterStaff.accounts = meterStaff.accounts.map((account) => account.id === id ? { ...account, state: "Closed" } : account);
        renderCustomerOwn();
        renderMeterStaff();
        renderMeterAccounts();
      }
      await readRegistry();
      const current = await request(kind + "/" + encodeURIComponent(id) + "?" + registryQuery());
      checkedRegistryRows([current], registry.workspaceId, registry.areaId);
      if (current.id !== id) throw new ApiError(200, "некорректно_ответ", "");
      renderRegistryDetail(current);
      showNotice("Изменение сохранено. Если запись исчезла из списка, проверьте фильтры.");
    } catch (error) {
      if (error.status === 403 || (error.status === 404 && error.code === "кабинет_жизненный_цикл_не_найдено")) resetRegistry();
      if (error.code === "кабинет_жизненный_цикл_редакция_конфликт") {
        registry.lifecycleStale = true;
        $("registry-lifecycle-note").textContent = "Карточка устарела. Откройте ее заново из списка перед новым действием. Поля не отправлялись повторно автоматически.";
      }
      handleError(error);
      if (confirmed && state.me) showNotice("Изменение подтверждено, но актуальная карточка не загружена. Обновите список и откройте карточку. " + errorMessage(error), true);
    } finally { setBusy(false); }
  });

  ui.registryHistoryButton.addEventListener("click", async () => {
    if (busy || !registryLifecycleReady()) return;
    clearNotice();
    setBusy(true);
    ui.registryHistory.replaceChildren();
    $("registry-history-empty").hidden = false;
    $("registry-history-empty").textContent = "История еще не загружена.";
    try {
      await readRegistryHistory();
      showNotice("История загружена. Последние изменения показаны первыми.");
    } catch (error) {
      if (error.status === 403 || (error.status === 404 && error.code === "кабинет_жизненный_цикл_не_найдено")) resetRegistry();
      handleError(error);
    } finally { setBusy(false); }
  });

  ui.registryExportButton.addEventListener("click", async () => {
    if (busy || !registryContextReady() || !registrySchemas.has(registry.kind)) return;
    const { workspaceId, areaId, kind, filters } = registry;
    let query = "workspaceId=" + encodeURIComponent(workspaceId) + "&areaId=" + encodeURIComponent(areaId);
    if (filters.state) query += "&state=" + encodeURIComponent(filters.state);
    if (filters.search) query += "&search=" + encodeURIComponent(filters.search);
    clearNotice();
    setBusy(true);
    let objectURL = "";
    let anchor = null;
    try {
      const blob = await requestRegistryCSV("registry-exports/" + kind + "?" + query);
      objectURL = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = objectURL;
      anchor.download = "vodokanal-training-" + kind + ".csv";
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      showNotice("CSV последней загруженной выборки передан браузеру для скачивания.");
    } catch (error) {
      if (error.status === 403) resetRegistry();
      handleError(error);
    } finally {
      if (anchor) anchor.remove();
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = "";
      setBusy(false);
    }
  });

  ui.customerRefreshButton.addEventListener("click", async () => {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    try {
      await readCustomerOwn();
      showNotice("Ваши заявки и подтвержденные лицевые счета загружены независимо от выбранного пространства.");
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  });
  ui.customerRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !state.me) return;
    const personalAccountId = ui.customerAccountId.value.trim();
    if (!validPublicId(personalAccountId)) {
      showNotice("Укажите идентификатор счёта, полученный у сотрудника.", true);
      return;
    }
    const payload = { personalAccountId };
    await customerMutation(async () => {
      await request("account-link-requests", { method: "POST", headers: { "Idempotency-Key": creationKey("customerLink", payload) }, body: payload });
      pendingCreations.customerLink = null;
      ui.customerAccountId.value = "";
    }, "Заявка отправлена на проверку сотруднику. До одобрения данные счета недоступны.");
  });
  ui.customerStaffArea.addEventListener("change", () => {
    if (busy) return;
    resetCustomerPending();
    setBusy(false);
  });
  ui.customerQueueForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !registryAreaAllowed(ui.customerStaffArea.value)) return;
    clearNotice();
    setBusy(true);
    try {
      await readCustomerPending();
      showNotice("Очередь заявок загружена.");
    } catch (error) {
      if (error.status === 403) resetCustomerPending();
      handleError(error);
    } finally { setBusy(false); }
  });
  ui.customerStaffRevokeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !registryAreaAllowed(ui.customerStaffArea.value)) return;
    const linkId = ui.customerStaffLinkId.value.trim();
    const rawRevision = ui.customerStaffLinkRevision.value.trim();
    const expectedRevision = Number(rawRevision);
    let reason;
    try { reason = checkedCustomerReason(ui.customerStaffReason.value, true); }
    catch (error) { handleError(error); return; }
    if (!validPublicId(linkId) || !rawRevision || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 999999999999999) {
      showNotice("Скопируйте идентификатор доступа и версию записи из карточки клиента.", true);
      return;
    }
    await customerMutation(async () => {
      await request("personal-account-links/" + encodeURIComponent(linkId) + "/actions/revoke", { method: "POST", body: { expectedRevision, reason } });
      ui.customerStaffLinkId.value = "";
      ui.customerStaffLinkRevision.value = "";
      ui.customerStaffReason.value = "";
    }, "Персональная связь отозвана по основанию сотрудника. Отдельные служебные роли не изменились.", true);
  });

  m.staffArea.addEventListener("change", () => {
    if (busy) return;
    resetMeterStaff();
    renderMeterAccounts();
    setBusy(false);
  });
  m.staffLoadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !registryAreaAllowed(m.staffArea.value)) return;
    clearNotice();
    setBusy(true);
    try { await readMeterStaff(); showNotice("Паспорта и лицевые счета загружены."); }
    catch (error) { meterFailure(error, true); }
    finally { setBusy(false); }
  });
  m.installAccount.addEventListener("change", () => { updateMeterInstallPoint(); setBusy(busy); });
  m.installPassport.addEventListener("change", () => { setBusy(busy); });
  m.passportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !meterStaffReady()) return;
    let payload;
    try {
      const serialNumber = meterText(m.serial.value, 64).toUpperCase();
      if (!/^[A-Z0-9/_-]+$/.test(serialNumber) || !/[A-Z0-9]/.test(serialNumber)) throw new ApiError(400, "кабинет_счетчик_некорректно_поле", "");
      payload = { workspaceId: state.workspaceId, areaId: m.staffArea.value,
        name: meterText(m.passportName.value, 150), meterType: meterText(m.passportType.value, 32),
        manufacturer: meterText(m.manufacturer.value, 64).toUpperCase(), model: meterText(m.model.value, 64).toUpperCase(),
        serialNumber, unit: "m3", digits: meterNumber(m.digits.value, 1, 12, 0),
        coefficient: meterNumber(m.coefficient.value, 0.001, 1000000), verificationUntil: meterUTC(m.verification.value) };
      if (Date.parse(payload.verificationUntil) <= Date.now()) throw new ApiError(409, "кабинет_счетчик_поверка_истекло", "");
    } catch (error) { handleError(error); return; }
    await meterMutation("meterPassport", "meter-passports", payload, async () => {
      [m.passportName, m.passportType, m.manufacturer, m.model, m.serial, m.verification].forEach((input) => { input.value = ""; });
      await readMeterStaff();
    }, "Паспорт создан или подтвержден точным повтором запроса. Установка — отдельное действие.", true);
  });
  m.installForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !meterStaffReady()) return;
    const passport = meterStaff.passports.find((item) => item.id === m.installPassport.value);
    const account = meterStaff.accounts.find((item) => item.id === m.installAccount.value && item.state === "Active");
    if (!passport || !account || !meterLivePassport(passport)) return;
    let payload;
    try {
      payload = { passportId: passport.id, personalAccountId: account.id, servicePointId: account.servicePointId,
        installedAt: meterUTC(m.installedAt.value), admittedAt: meterUTC(m.admittedAt.value), initialValue: meterValueForPassport(m.initialValue.value, passport) };
      if (Date.parse(payload.installedAt) > Date.parse(payload.admittedAt)) throw new ApiError(400, "кабинет_счетчик_некорректно_даты", "");
    } catch (error) { handleError(error); return; }
    await meterMutation("meterInstallation", "meter-installations", payload, async (result) => {
      [m.installedAt, m.admittedAt, m.initialValue].forEach((input) => { input.value = ""; });
      await readMeterStaff();
      m.mode.value = "staff";
      renderMeterAccounts();
      m.accountSelect.value = payload.personalAccountId;
      await readMeterInstallations();
      if (meterView.installation?.id !== result.id && meterView.installations.some((item) => item.id === result.id)) {
        m.installationSelect.value = result.id;
        await readMeterDetail();
      }
    }, "Установка создана или подтверждена повтором. Начальное значение — база, не присланное измерение.", true);
  });
  m.refreshAccountsButton.addEventListener("click", async () => {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    try {
      await readCustomerOwn();
      m.status.textContent = customer.accounts.length ? "Счета обновлены. Выберите свой счёт и загрузите приборы." : "Подтверждённых счетов в этой выборке нет. Запросите доступ в разделе «Мои лицевые счета».";
    }
    catch (error) { meterFailure(error); }
    finally { setBusy(false); }
  });
  m.accountSelect.addEventListener("change", () => {
    if (busy) return;
    resetMeterView();
    renderMeterAccounts();
    setBusy(false);
  });
  m.mode.addEventListener("change", () => {
    if (busy) return;
    resetMeterView();
    renderMeterAccounts();
    setBusy(false);
  });
  m.loadInstallationsButton.addEventListener("click", async () => {
    if (busy || !meterAccount(m.accountSelect.value)) return;
    clearNotice();
    setBusy(true);
    try { await readMeterInstallations(); }
    catch (error) { meterFailure(error); }
    finally { setBusy(false); }
  });
  m.installationSelect.addEventListener("change", () => {
    if (busy) return;
    resetMeterView(true);
    setBusy(false);
  });
  m.openInstallationButton.addEventListener("click", async () => {
    if (busy || !meterView.installations.some((item) => item.id === m.installationSelect.value)) return;
    clearNotice();
    setBusy(true);
    try { await readMeterDetail(); }
    catch (error) { meterFailure(error); }
    finally { setBusy(false); }
  });
  m.correctionReading.addEventListener("change", () => { setBusy(busy); });
  m.readingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !meterCanSubmit() || meterReading.phase !== "idle") return;
    clearMeterReadingError();
    let measuredAt, value;
    const dateParts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(m.measuredAt.value.trim());
    if (!dateParts || Number(dateParts[3]) < 1) { showMeterReadingError(m.measuredAt, "Укажите существующую дату в формате ДД.ММ.ГГГГ, например 21.10.2026."); return; }
    const time = m.measuredTime.value.trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) { showMeterReadingError(m.measuredTime, "Укажите время от 00:00 до 23:59 в формате ЧЧ:ММ."); return; }
    try {
      measuredAt = meterUTC(dateParts[3] + "-" + dateParts[2] + "-" + dateParts[1] + "T" + time + ":00");
      if (meterDate(measuredAt) < meterDate(meterView.installation.admittedAt) || meterDate(measuredAt) > Date.now() + 300000) throw new ApiError(400, "кабинет_счетчик_некорректно_даты", "");
    } catch (error) { showMeterReadingError(m.measuredAt, "Укажите фактические дату и время: не раньше допуска прибора и не более чем на 5 минут вперёд."); return; }
    try {
      value = meterValueForPassport(m.readingValue.value, meterView.installation.passport);
      const head = meterView.installation.acceptedHead;
      if (meterDate(measuredAt) > meterDate(head.measuredAt) && value < head.value) throw new ApiError(400, "кабинет_счетчик_показание_уменьшено", "");
    } catch (error) { showMeterReadingError(m.readingValue, errors[error.code] || errors.кабинет_счетчик_некорректно_значение); return; }
    const payload = Object.freeze({ meterInstallationId: meterView.installation.id, measuredAt, value });
    meterReading.intent = Object.freeze({ epoch: meterEpoch, actorId: state.me.accountId, payload, key: creationKey("meterReading", { path: "meter-readings", payload }) });
    await sendMeterReading();
  });
  m.retry.addEventListener("click", async () => { if (meterReading.phase === "unknown") await sendMeterReading(); });
  m.refreshReading.addEventListener("click", async () => {
    if (busy || meterReading.phase !== "confirmed" || !meterReading.refreshFailed) return;
    const intent = meterReading.intent;
    setBusy(true);
    try {
      await readMeterDetail();
      if (sameMeterIntent(intent)) { meterReading.refreshFailed = false; meterReading.diagnostic = ""; }
    } catch (error) {
      if (!sameMeterIntent(intent)) return;
      if ([401, 403, 404].includes(error.status) || noNativeSession(error)) meterFailure(error);
      else {
        meterView.stale = true;
        m.status.textContent = "Прибор и историю пока не удалось обновить. Результат передачи показан ниже.";
        meterReading.diagnostic = error.code + (error.requestId ? " · " + error.requestId : "");
      }
    } finally { renderMeterReadingState(); setBusy(false); if (sameMeterIntent(intent)) $("meter-reading-result-heading").focus(); }
  });
  m.nextReading.addEventListener("click", () => {
    if (busy || !meterCanSubmit() || meterReading.phase !== "confirmed" || meterReading.refreshFailed) return;
    meterReading = emptyMeterReading();
    m.measuredAt.value = "";
    m.measuredTime.value = "";
    m.readingValue.value = "";
    clearMeterReadingError();
    renderMeterReadingState();
    setBusy(false);
    m.measuredAt.focus();
  });
  [m.measuredAt, m.measuredTime, m.readingValue].forEach((input) => input.addEventListener("input", () => { if (meterReading.phase === "idle") clearMeterReadingError(); }));
  m.correctionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !meterCanCorrect()) return;
    const original = meterView.readings.find((row) => row.id === m.correctionReading.value && row.state === "Accepted");
    if (!original) return;
    let payload;
    try {
      payload = { reason: meterText(m.correctionReason.value, 2000), proposedValue: meterValueForPassport(m.proposedValue.value, meterView.installation.passport), proposedMeasuredAt: meterUTC(m.proposedAt.value) };
      if (Date.parse(payload.proposedMeasuredAt) < meterDate(meterView.installation.admittedAt)) throw new ApiError(400, "кабинет_счетчик_некорректно_даты", "");
    } catch (error) { handleError(error); return; }
    await meterMutation("meterCorrection", "meter-readings/" + encodeURIComponent(original.id) + "/correction-requests", payload, async (result) => {
      if (result.state !== "Pending" || result.readingId !== original.id) throw new ApiError(200, "некорректно_ответ", "");
      $("meter-correction-receipt").textContent = "Запрос на исправление получен. Предложено " + result.proposedValue + " м³ на " + meterTime(result.proposedMeasuredAt) + ". Исходное показание и расход не изменены.";
      meterSupport($("meter-correction-receipt"), [["ID заявки", result.id], ["Статус", result.state]]);
      [m.proposedAt, m.proposedValue, m.correctionReason].forEach((input) => { input.value = ""; });
    }, "Запрос на исправление получен. Сотрудник расчётного отдела рассматривает его в разделе «Показания и доставка воды». До согласования исходное показание и расход не изменяются.");
  });

  ui.refreshSessionsButton.addEventListener("click", async () => {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    try {
      await readOwnSessions();
      showNotice("Список ваших сеансов обновлен из 1С.");
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  });

  ui.revokeAllSessionsButton.addEventListener("click", async () => {
    if (busy || !state.me) return;
    clearNotice();
    setBusy(true);
    try {
      const result = await request("account/sessions/actions/revoke-all", { method: "POST", body: {} });
      if (result.reauthenticationRequired !== true || !Number.isSafeInteger(result.revokedCount) || result.revokedCount < 0) {
        throw new ApiError(200, "некорректно_ответ", "");
      }
      clearSession("Все ваши сеансы завершены. Войдите заново.");
      showNotice("Все ваши сеансы отозваны. Данные кабинета очищены.");
      ui.username.focus();
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  });

  w.area.addEventListener("change", () => {
    if (busy) return;
    resetWater();
    renderWaterAccess();
    setBusy(false);
  });
  w.loadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !waterAreaAllowed(w.area.value)) return;
    clearNotice();
    setBusy(true);
    resetWater();
    try { await readWaterScope(); showNotice("Заказы загружены. Для просмотра остатков и движений выберите точку."); }
    catch (error) { waterFailure(error); }
    finally { setBusy(false); }
  });
  w.setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !waterReady() || !["sources", "points", "recipients"].includes(w.setupKind.value)) return;
    let payload;
    try { payload = { ...waterScopeBody(), name: waterText(w.setupName.value, 150) }; }
    catch (error) { handleError(error); return; }
    await waterMutation("water/" + w.setupKind.value, payload, water.pointId);
  });
  w.point.addEventListener("change", () => { if (!busy) { clearWaterPoint(); setBusy(false); } });
  w.pointLoadButton.addEventListener("click", async () => {
    if (busy || !waterReady() || !waterSetupRef("points", w.point.value)) return;
    const pointId = w.point.value;
    clearNotice();
    setBusy(true);
    clearWaterPoint();
    try { await readWaterPoint(pointId); showNotice("Остатки и страница движений выбранной точки загружены. При наличии продолжения используйте кнопку под списком."); }
    catch (error) { waterFailure(error); }
    finally { setBusy(false); }
  });
  async function submitWaterReceipt(seed) {
    if (busy || !waterReady()) return;
    let payload;
    try {
      payload = { ...waterScopeBody(), sourceId: waterRef("sources", w.source.value), pointId: waterRef("points", w.receiptPoint.value), occurredAt: waterUTC(w.occurredAt.value), basis: waterText(w.basis.value, 2000) };
      if (!seed) payload.quantity = waterQuantity(w.quantity.value);
    } catch (error) { handleError(error); return; }
    await waterMutation(seed ? "water/stock/seed" : "water/receipts", payload, payload.pointId);
  }
  w.receiptForm.addEventListener("submit", async (event) => { event.preventDefault(); await submitWaterReceipt(false); });
  w.seedButton.addEventListener("click", async () => { await submitWaterReceipt(true); });
  w.orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !waterReady()) return;
    let payload;
    try {
      payload = { ...waterScopeBody(), pointId: waterRef("points", w.orderPoint.value), recipientId: waterRef("recipients", w.recipient.value), quantity: waterQuantity(w.orderQuantity.value), scheduledAt: waterUTC(w.scheduledAt.value) };
    } catch (error) { handleError(error); return; }
    await waterMutation("water/orders", payload, payload.pointId, true);
  });
  w.action.addEventListener("change", () => {
    if (busy) return;
    w.returnQuantity.value = "";
    w.returnReason.value = "";
    $("water-return-fields").hidden = w.action.value !== "return";
    setBusy(false);
  });
  w.actionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !waterReady() || water.stale || !water.detail || !waterLegalActions().some(([code]) => code === w.action.value)) return;
    const item = water.detail;
    let payload;
    try {
      if (!Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision >= 999999999999999) throw new ApiError(400, "кабинет_вода_некорректно_редакция", "");
      payload = { expectedRevision: item.revision };
      if (w.action.value === "return") {
        payload.quantity = waterQuantity(w.returnQuantity.value);
        payload.reason = waterText(w.returnReason.value, 2000);
        if (Math.round(payload.quantity * 1000) > Math.round(item.quantity * 1000) - Math.round(item.returnedQuantity * 1000)) throw new ApiError(409, "кабинет_вода_возврат_превышает_выдано", "");
      }
    } catch (error) { handleError(error); return; }
    await waterMutation("water/orders/" + encodeURIComponent(item.id) + "/actions/" + w.action.value, payload, item.pointId);
  });
  [w.source, w.receiptPoint, w.orderPoint, w.recipient].forEach((control) => { control.addEventListener("change", () => { if (!busy) setBusy(false); }); });

  d.ownLoadButton.addEventListener("click", () => dispatchRun(readDispatchOwn));
  d.intakeLoadButton.addEventListener("click", () => {
    if (!dispatchOwner()) return;
    return dispatchRun(readDispatchOwned);
  });
  d.intake.addEventListener("change", () => {
    if (busy) return;
    renderDispatchIntakeChoices();
    [d.title, d.description, d.contact].forEach((input) => { input.value = ""; });
    setBusy(false);
  });
  d.intakeSelect.addEventListener("change", () => {
    if (busy || !dispatchOwner() || !dispatch.ownedLoaded) return;
    fillDispatchIntake();
    setBusy(false);
  });
  function changeDispatchScope() {
    if (busy) return;
    resetDispatch();
    setBusy(false);
  }
  d.area.addEventListener("change", changeDispatchScope);
  d.state.addEventListener("change", () => {
    if (busy) return;
    dispatch.queue = [];
    dispatch.loaded = false;
    d.queue.replaceChildren();
    clearDispatchCard(true);
    clearDispatchIncident();
    d.incidentsList.replaceChildren();
    setBusy(false);
  });
  d.loadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dispatchAreaAllowed(d.area.value)) return;
    return dispatchRun(async () => {
      clearDispatchCard(true);
      clearDispatchIncident();
      for (const input of [d.incidentTitle, d.incidentStartedAt, d.incidentForecastAt, d.incidentDescription]) input.value = "";
      await readDispatchStaff();
    });
  });

  function dispatchForm(form, guard, build, path, kind) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (busy || !guard()) return;
      return dispatchRun(async () => {
        const payload = build();
        await dispatchMutation(path(), payload, kind);
      });
    });
  }
  dispatchForm(d.intakeForm, () => dispatchOwner() && dispatch.ownedLoaded && !dispatch.intakeStale, () => {
    const addresses = d.intakeAddresses.value.split(/\r?\n/).filter((line) => line.trim()).map((line) => dispatchText(line, 250));
    const categories = d.intakeCategories.value.split(",").map((value) => value.trim());
    if (!addresses.length || addresses.length > 30 || new Set(addresses).size !== addresses.length || !categories.length || categories.length > 8 ||
      new Set(categories).size !== categories.length || categories.some((category) => !dispatchCategories.includes(category)) ||
      !["true", "false"].includes(d.intakePublished.value) || !["true", "false"].includes(d.intakeAccepting.value) ||
      !state.areas.some((area) => area.id === d.intakeArea.value && area.workspaceId === state.workspaceId && area.state === "Active")) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    const payload = { defaultAreaId: d.intakeArea.value, name: dispatchText(d.intakeName.value, 150), addresses, categories,
      published: d.intakePublished.value === "true", accepting: d.intakeAccepting.value === "true" };
    if (payload.accepting && !payload.published) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    if (dispatch.intakeEditing) payload.expectedRevision = dispatch.intakeEditing.revision;
    else payload.workspaceId = state.workspaceId;
    return payload;
  }, () => dispatch.intakeEditing ? "dispatch/intakes/" + encodeURIComponent(dispatch.intakeEditing.id) + "/actions/configure" : "dispatch/intakes", "intake");

  dispatchForm(d.requestForm, () => !!state.me && dispatch.ownLoaded, () => {
    const intake = dispatch.publicIntakes.find((row) => row.id === d.intake.value && row.accepting);
    if (!intake || !intake.addresses.includes(d.address.value) || !intake.categories.includes(d.category.value)) throw new ApiError(400, "кабинет_диспетчерская_необслуживаемо_адрес_или_категория", "");
    const contact = dispatchText(d.contact.value, 128);
    if (/[^\x20-\x7e]/.test(contact)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    return { publicIntakeId: intake.id, address: d.address.value, category: d.category.value,
      title: dispatchText(d.title.value, 150), description: dispatchText(d.description.value, 2000, true), contact };
  }, () => "my/requests", "own");
  dispatchForm(d.ownReplyForm, () => !!dispatch.own && !dispatch.ownStale && !dispatchTerminal(dispatch.own), () =>
    ({ expectedRevision: dispatch.own.revision, text: dispatchText(d.ownReplyText.value, 4000, true) }), () => "my/requests/" + encodeURIComponent(dispatch.own.id) + "/messages", "own");
  dispatchForm(d.ownReopenForm, () => !!dispatch.own && !dispatch.ownStale && dispatchTerminal(dispatch.own), () =>
    ({ expectedRevision: dispatch.own.revision, reason: dispatchText(d.ownReopenReason.value, 250) }), () => "my/requests/" + encodeURIComponent(dispatch.own.id) + "/actions/reopen", "own");
  dispatchForm(d.actionForm, () => dispatchReady() && !!dispatch.staff && !dispatch.staffStale && dispatchLegalActions().some(([action]) => action === d.action.value), () =>
    ({ expectedRevision: dispatch.staff.revision, reason: dispatchText(d.reason.value, 250) }), () => "dispatch/requests/" + encodeURIComponent(dispatch.staff.id) + "/actions/" + d.action.value, "staff");
  dispatchForm(d.staffReplyForm, () => dispatchReady() && !!dispatch.staff && !dispatch.staffStale, () => {
    if (!["Public", "Internal"].includes(d.staffReplyVisibility.value) || (dispatchTerminal(dispatch.staff) && d.staffReplyVisibility.value !== "Internal")) throw new ApiError(400, "кабинет_диспетчерская_некорректно_действие", "");
    return { expectedRevision: dispatch.staff.revision, text: dispatchText(d.staffReplyText.value, 4000, true) };
  }, () => "dispatch/requests/" + encodeURIComponent(dispatch.staff.id) + (d.staffReplyVisibility.value === "Internal" ? "/internal-notes" : "/messages"), "staff");
  dispatchForm(d.triageForm, () => dispatchReady() && !!dispatch.staff && !dispatch.staffStale && !dispatchTerminal(dispatch.staff), () => {
    if (!dispatchPriorities.includes(d.priority.value)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    const dueAt = dispatchUTC(d.dueAt.value), time = Date.parse(dueAt);
    if (time < Date.now() || time > Date.now() + 2592000000) throw new ApiError(400, "кабинет_диспетчерская_некорректно_даты", "");
    return { expectedRevision: dispatch.staff.revision, priority: d.priority.value, dueAt, reason: dispatchText(d.triageReason.value, 250) };
  }, () => "dispatch/requests/" + encodeURIComponent(dispatch.staff.id) + "/triage", "staff");
  dispatchForm(d.incidentForm, dispatchReady, () => {
    if (!["Leak", "Supply", "Sewer", "Other"].includes(d.incidentType.value) || !dispatchSeverities.includes(d.incidentSeverity.value)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
    const startedAt = dispatchUTC(d.incidentStartedAt.value), forecastAt = dispatchUTC(d.incidentForecastAt.value);
    if (Date.parse(startedAt) > Date.now() + 300000 || Date.parse(forecastAt) < Date.parse(startedAt) || Date.parse(forecastAt) > Date.now() + 7776000000) throw new ApiError(400, "кабинет_диспетчерская_некорректно_даты", "");
    return { ...dispatchScopeBody(), title: dispatchText(d.incidentTitle.value, 150), type: d.incidentType.value, severity: d.incidentSeverity.value,
      startedAt, forecastAt, description: dispatchText(d.incidentDescription.value, 2000, true) };
  }, () => "dispatch/incidents", "incident");
  dispatchForm(d.incidentActionForm, () => dispatchReady() && !!dispatch.incident && !dispatch.incidentStale && dispatch.incident.state === "Open", () => {
    if (!["update", "resolve"].includes(d.incidentAction.value)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_действие", "");
    const payload = { expectedRevision: dispatch.incident.revision, reason: dispatchText(d.incidentReason.value, 250) };
    if (d.incidentAction.value === "update") {
      if (!dispatchSeverities.includes(d.incidentUpdateSeverity.value)) throw new ApiError(400, "кабинет_диспетчерская_некорректно_поле", "");
      payload.severity = d.incidentUpdateSeverity.value;
      payload.forecastAt = dispatchUTC(d.incidentUpdateForecastAt.value);
      if (Date.parse(payload.forecastAt) < Date.parse(dispatch.incident.startedAt.endsWith("Z") ? dispatch.incident.startedAt : dispatch.incident.startedAt + "Z") || Date.parse(payload.forecastAt) > Date.now() + 7776000000) throw new ApiError(400, "кабинет_диспетчерская_некорректно_даты", "");
      payload.description = dispatchText(d.incidentUpdateDescription.value, 2000, true);
    }
    return payload;
  }, () => "dispatch/incidents/" + encodeURIComponent(dispatch.incident.id) + "/actions/" + d.incidentAction.value, "incident");
  dispatchForm(d.relationForm, () => dispatchRelationActions().some(([action]) => action === d.relationAction.value), () =>
    ({ requestExpectedRevision: dispatch.staff.revision, incidentExpectedRevision: dispatch.incident.revision, reason: dispatchText(d.relationReason.value, 250) }), () =>
    "dispatch/requests/" + encodeURIComponent(dispatch.staff.id) + "/incidents/" + encodeURIComponent(dispatch.incident.id) + "/actions/" + d.relationAction.value, "relation");
  d.ownHistoryButton.addEventListener("click", () => dispatchRun(() => readDispatchHistory(false)));
  d.staffHistoryButton.addEventListener("click", () => dispatchRun(() => readDispatchHistory(true)));
  for (const staff of [false, true]) {
    const kind = fileKind(staff), panel = filePanels[kind];
    panel.load.addEventListener("click", () => filesRun(staff, async (task) => {
      const receipt = requestFiles[kind].receipt;
      requestFiles[kind].detail = null;
      panel.detail.replaceChildren(); panel.input.value = ""; panel.reason.value = "";
      await readRequestFiles(staff, task);
      if (receipt) await readRequestFile(receipt.id, staff, task);
    }));
    panel.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!filesWritable(staff, panel.visibility.value) || requestFiles[kind].stale) return;
      return filesRun(staff, (task) => uploadRequestFile(staff, false, task));
    });
    panel.replace.addEventListener("click", () => {
      if (!fileReplaceAllowed(staff)) return;
      return filesRun(staff, (task) => uploadRequestFile(staff, true, task));
    });
    panel.visibility.addEventListener("change", () => {
      if (busy) return;
      if ((!staff && panel.visibility.value !== "Public") || !["Public", "Internal"].includes(panel.visibility.value)) panel.visibility.value = "Public";
      setBusy(false);
    });
    panel.cancel.addEventListener("click", () => {
      if (fileTask?.kind === kind) { fileTask.cancelled = true; fileTask.controller.abort(); }
      panel.input.value = ""; panel.reason.value = ""; panel.detail.replaceChildren(); requestFiles[kind].detail = null; requestFiles[kind].detailButtons = [];
      panel.note.textContent = "Выбор файла и незавершенные поля очищены. После отмены отправки загрузите список: сервер мог уже сохранить команду.";
      setBusy(busy);
    });
  }
  Object.assign(errors, {
    кабинет_файл_некорректно_тело: "Файл не отправлен: неподдерживаемая структура запроса.",
    кабинет_файл_некорректно_поле: "Выберите один файл и проверьте обязательные поля и причину замены.",
    кабинет_файл_некорректно_имя_файла: "Имя файла: до 120 символов, латинские буквы, цифры, пробел и _ . -. Без двойных точек и системных имён.",
    кабинет_файл_некорректно_база64: "Не удалось отправить файл. Выберите его заново и повторите загрузку.",
    кабинет_файл_некорректно_размер: "Размер одного файла должен быть от 1 байта до 5 МиБ.",
    кабинет_файл_некорректно_тип: "Допустимы PDF, PNG, JPEG и TXT/CSV в кодировке UTF-8.",
    кабинет_файл_загрузивший_требуется: "Заменять файл может только исходный загрузивший с текущим доступом к заявке.",
    кабинет_файл_не_найдено: "Файл не найден или недоступен текущей учетной записи.",
    кабинет_файл_редакция_конфликт: "Версия файла изменилась. Загрузите актуальные версии перед заменой.",
    кабинет_файл_запрос_конфликт: "Этот запрос уже использован для другой операции. Проверьте результат перед повторной отправкой.",
    кабинет_файл_привязка_конфликт: "Обнаружен конфликт привязки файла. Обратитесь к администратору.",
    кабинет_файл_целостность_конфликт: "Не удалось подтвердить целостность файла. Скачивание остановлено.",
    кабинет_файл_квота_превышено: "Лимит сохраненных файлов или версий исчерпан. Старые версии учитываются; удаление и сброс квоты недоступны."
  });

  ui.workspaceSelect.addEventListener("change", async () => {
    if (busy || !state.me) return;
    const workspaceId = ui.workspaceSelect.value;
    clearNotice();
    setBusy(true);
    try {
      await loadDashboard(workspaceId);
    } catch (error) {
      ui.workspaceSelect.value = state.workspaceId;
      handleError(error);
    } finally { setBusy(false); }
  });

  ui.workspaceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !state.me || hostCreateIntent) return;
    const name = ui.workspaceName.value.trim();
    if (!name || name.length > 150) return;
    let intent;
    try { intent = prepareHostCreation("workspaces", { name }, async result => {
      await loadDashboard(typeof result.id === "string" ? result.id : "");
      ui.workspaceName.value = "";
      showNotice("Личное пространство открыто. Если оно уже существовало, название не изменилось.");
    }); } catch (error) { handleError(error); return; }
    await sendHostCreation(intent);
  });

  ui.roleSelect.addEventListener("change", updateAssignmentButton);
  ui.roleTarget.addEventListener("change", updateAssignmentButton);
  ui.roleArea.addEventListener("change", updateAssignmentButton);
  ui.roleScope.addEventListener("change", updateScopeFields);
  ui.invitationScope.addEventListener("change", updateScopeFields);
  ui.roleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !isOwner()) return;
    const role = ui.roleSelect.value;
    if (!roles.has(role)) return;
    const accountId = ui.roleTarget.value;
    if (!activeTargets().has(accountId)) return;
    let scope;
    try { scope = selectedScope(ui.roleScope, ui.roleArea); }
    catch (error) { handleError(error); return; }
    const existing = state.memberships.find((row) => row.accountId === accountId &&
      row.role === role && row.areaId === scope.areaId);
    const expectedRevision = existing ? existing.revision : 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      showNotice("Не удалось загрузить версию назначения. Обновите данные.", true);
      return;
    }
    clearNotice();
    setBusy(true);
    try {
      await request("memberships", { method: "POST", body: {
        workspaceId: state.workspaceId, accountId, role, ...scope, expectedRevision
      } });
      await loadDashboard(state.workspaceId);
      showNotice("Роль «" + roles.get(role) + "» назначена выбранному участнику.");
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  });

  function selectedScope(scopeSelect, areaSelect) {
    if (scopeSelect.value === "All") return { areaScope: "All", areaId: "" };
    if (scopeSelect.value !== "Area" || !state.areas.some((area) => area.id === areaSelect.value && area.state === "Active")) {
      throw new ApiError(400, "кабинет_область_не_найдено", "");
    }
    return { areaScope: "Area", areaId: areaSelect.value };
  }

  function creationKey(kind, payload) {
    const signature = JSON.stringify(payload);
    if (pendingCreations[kind]?.signature === signature) return pendingCreations[kind].key;
    if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") throw new ApiError(0, "кабинет_шифрование_недоступно", "");
    const key = globalThis.crypto.randomUUID();
    pendingCreations[kind] = { signature, key };
    return key;
  }

  ui.areaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !isOwner()) return;
    const name = ui.areaName.value.trim();
    if (!name || name.length > 150) return;
    const payload = { workspaceId: state.workspaceId, name };
    await mutate(async () => {
      await request("areas", { method: "POST", headers: { "Idempotency-Key": creationKey("area", payload) }, body: payload });
      pendingCreations.area = null;
      ui.areaName.value = "";
    }, "Область создана в выбранном пространстве.");
  });

  ui.invitationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !isOwner()) return;
    const recipientAccountId = ui.invitationRecipient.value.trim();
    const role = ui.invitationRole.value;
    const ttlSeconds = Number(ui.invitationTTL.value);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipientAccountId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(recipientAccountId)) {
      showNotice("Укажите идентификатор из профиля получателя.", true);
      return;
    }
    if (!roles.has(role) || !Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 604800) return;
    let scope;
    try { scope = selectedScope(ui.invitationScope, ui.invitationArea); }
    catch (error) { handleError(error); return; }
    const payload = { workspaceId: state.workspaceId, recipientAccountId, role, ...scope, ttlSeconds };
    await mutate(async () => {
      await request("invitations", { method: "POST", headers: { "Idempotency-Key": creationKey("invitation", payload) }, body: payload });
      pendingCreations.invitation = null;
      ui.invitationRecipient.value = "";
    }, "Приглашение отправлено. Доступ появится только после принятия получателем.");
  });

  ui.passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !state.me) return;
    let currentPassword = ui.currentPassword.value;
    let newPassword = ui.newPassword.value;
    let confirmation = ui.confirmPassword.value;
    [ui.currentPassword, ui.newPassword, ui.confirmPassword].forEach((input) => { input.value = ""; });
    const valid = currentPassword && newPassword === confirmation && newPassword.length >= 12 &&
      newPassword.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(newPassword);
    confirmation = "";
    if (!valid) {
      currentPassword = "";
      newPassword = "";
      showNotice("Заполните текущий пароль и два одинаковых новых пароля: 12–128 символов без управляющих символов.", true);
      return;
    }
    const identity = { nativeName: state.me.nativeName, actorId: state.me.actorId, accountId: state.me.accountId };
    let authorization = basicCredentials(identity.nativeName, currentPassword);
    currentPassword = "";
    clearNotice();
    setBusy(true);
    let changed = false;
    let failure = null;
    try {
      await finishNativeSession();
      const fresh = await request("auth/session", {
        method: "POST", headers: { Authorization: authorization, IBSession: "start" }, body: {}
      });
      authorization = "";
      validateIdentity(fresh);
      if (fresh.accountId !== identity.accountId || fresh.actorId !== identity.actorId) throw new ApiError(403, "кабинет_участник_несовпадение", "");
      const result = await request("account/password", {
        method: "POST", headers: { IBSession: "finish" }, body: { newPassword }
      });
      newPassword = "";
      if (result.passwordChanged !== true || result.reauthenticationRequired !== true) throw new ApiError(200, "некорректно_ответ", "");
      changed = true;
    } catch (error) { failure = error; }
    finally {
      authorization = "";
      currentPassword = "";
      newPassword = "";
      try { await finishNativeSession(); } catch (_) {  }
      clearSession(changed ? "Пароль изменен. Войдите с новым паролем." : "Смена пароля не подтверждена. Войдите заново и проверьте результат.");
      showNotice(changed ? "Пароль изменен. Все прежние сессии аннулированы. Войдите с новым паролем." : errorMessage(failure, true), !changed);
      ui.username.focus();
    }
  });

  ui.logoutButton.addEventListener("click", async () => {
    if (busy) return;
    if (Object.values(moduleLocks).some(Boolean) && !confirm("Есть операция с неизвестным результатом. Выход очистит её данные в браузере, но не отменит возможную запись на сервере. После входа потребуется перечитать данные. Выйти?")) return;
    clearNotice();
    clearSession("Завершаем сеанс. Личные данные скрыты.");
    setBusy(true);
    let logoutError = null;
    try { await finishNativeSession(); }
    catch (error) { logoutError = error; }
    finally {
      clearSession(logoutError
        ? "Данные скрыты. Сервер не подтвердил завершение сессии; повторный вход сначала отправит запрос завершения."
        : "Вы вышли из личного кабинета.");
      if (logoutError) showNotice("Не удалось подтвердить выход на сервере. Закройте вкладку на общем устройстве. " + errorMessage(logoutError), true);
      ui.username.focus();
    }
  });

  $("notice-close").addEventListener("click", clearNotice);

  function activateSection(id, replace = false) {
    const target = $(id);
    if (!target || target.hidden || !state.me) return false;
    const viewOpened = globalThis.VodokanalShell?.activateSection?.(id);
    const href = "#" + id;
    for (const link of document.querySelectorAll('.navigation a[href^="#"]')) {
      const selected = link.getAttribute("href") === href;
      link.classList.toggle("selected", selected);
      if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    if (location.hash !== href) history[replace ? "replaceState" : "pushState"](null, "", href);
    const heading = target.querySelector("h1,h2,h3") || target;
    heading.tabIndex = -1; heading.focus({ preventScroll: Boolean(viewOpened) });
    if (viewOpened) window.scrollTo({ top: 0, behavior: "instant" }); else target.scrollIntoView({ block: "start" });
    return true;
  }

  function applyEntryRoute() {
    if (entryRouteApplied || !contextRendered || !state.me || busy) return;
    entryRouteApplied = true;
    const params = new URLSearchParams(location.search), service = params.getAll("service").length === 1 ? params.get("service") : "";
    const views = { lab: "lab", meter: "metering", request: "dispatch-center", water: $("water").hidden ? "subscriber-water-extra" : "water" };
    const labels = { lab: "Лабораторный анализ", meter: "Передача показаний", request: "Обращение в диспетчерскую", water: "Водоснабжение и доставка" };
    const note = $("service-entry-notice");
    if (Object.prototype.hasOwnProperty.call(views, service)) {
      const opened = activateSection(views[service], true);
      if (note) {
        note.textContent = opened ? "" : labels[service] + ": раздел недоступен. Обновите кабинет или обратитесь к владельцу рабочей области.";
        note.hidden = opened;
      }
    } else if (location.hash && [...document.querySelectorAll('.navigation a[href^="#"]')].some(link => link.getAttribute("href") === location.hash)) {
      activateSection(location.hash.slice(1), true);
    }
    if (params.has("auth")) {
      params.delete("auth");
      history.replaceState(null, "", location.pathname + (params.size ? "?" + params : "") + location.hash);
    }
  }
  for (const [value, label] of roles) {
    for (const select of [ui.roleSelect, ui.invitationRole]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
  }
  selectOptions(ui.registryEntity, [...registrySchemas].map(([key, schema]) => [key, schema.title]));
  ui.registryFilterState.value = "";
  ui.roleScope.value = "All";
  ui.invitationScope.value = "All";
  ui.invitationTTL.value = "86400";
  m.digits.value = "6";
  m.coefficient.value = "1";
  selectOptions(d.state, [["", "Все состояния"], ...dispatchStates.map((code) => [code, code])]);
  selectOptions(d.priority, dispatchPriorities.map((code) => [code, code]));
  selectOptions(d.incidentType, ["Leak", "Supply", "Sewer", "Other"].map((code) => [code, code]));
  for (const select of [d.incidentSeverity, d.incidentUpdateSeverity]) selectOptions(select, dispatchSeverities.map((code) => [code, code]));
  for (const select of [d.intakePublished, d.intakeAccepting]) selectOptions(select, [["false", "Нет"], ["true", "Да"]]);
  selectOptions(d.incidentAction, [["update", "Обновить тяжесть / прогноз / описание"], ["resolve", "Завершить инцидент"]]);
  if (globalThis.VodokanalLab?.create && $("lab-app")) {
    lab = globalThis.VodokanalLab.create({
      root: $("lab-app"), request, requestBinary: requestLabBinary, setGlobalBusy: setBusy,
      onSessionError(error) {
        if (error.status !== 401 && !noNativeSession(error)) return false;
        handleError(error);
        return true;
      }
    });
  }
  if (globalThis.VodokanalLabStaff?.create && $("lab-staff-app")) {
    labStaff = globalThis.VodokanalLabStaff.create({
      root: $("lab-staff-app"), request, requestBinary: requestLabBinary, setGlobalBusy: setBusy,
      onSessionError(error) {
        if (error.status !== 401 && !noNativeSession(error)) return false;
        handleError(error);
        return true;
      }
    });
  }
  if (globalThis.VodokanalInventory?.create && $("inventory-app")) {
    inventory = globalThis.VodokanalInventory.create({
      root: $("inventory-app"), request: requestInventory, setGlobalBusy: setBusy,
      onMutationLock(locked) { publishModuleLock("inventory", locked); },
      onSessionError(error, outcomeNotice = "") {
        if (error.status === 401 || noNativeSession(error)) {
          handleError(error);
          if (outcomeNotice) showNotice(outcomeNotice + " Сеанс завершён. Войдите снова.", true);
          return true;
        }
        if (error.status === 403 || error.status === 404) {
          inventoryAccessRejected = true;
          clearTimeout(inventoryLeaseTimer);
          inventoryLeaseTimer = null;
          $("inventory-nav").hidden = true;
          inventory.setExternalBusy(true);
          showNotice("Доступ к складскому участку не подтверждён. Обновите кабинет, чтобы заново проверить права.", true);
        }
        return false;
      }
    });
    $("inventory-nav").addEventListener("click", (event) => {
      if (busy) { event.preventDefault(); return; }
      syncInventoryContext();
      if ($("inventory").hidden || inventoryAccessRejected) { event.preventDefault(); return; }
      event.preventDefault();
      if (location.hash !== "#inventory") history.pushState(null, "", "#inventory");
      $("inventory-heading").focus();
    });
  }
  if (globalThis.VodokanalWorkMaterials?.create && $("work-materials-app")) {
    workMaterials = globalThis.VodokanalWorkMaterials.create({
      root: $("work-materials-app"), request: requestWorkMaterials,
      onMutationLock(locked) { publishModuleLock("materials", locked); },
      onSessionError(error, outcomeNotice = "") {
        if (error.status === 401 || noNativeSession(error)) {
          handleError(error);
          if (outcomeNotice) showNotice(outcomeNotice + " Сеанс завершён. Войдите снова.", true);
          return true;
        }
        if (error.status === 403 || error.status === 404) {
          workMaterialsAccessRejected = true;
          clearTimeout(workMaterialsLeaseTimer);
          workMaterialsLeaseTimer = null;
          $("work-materials-nav").hidden = true;
          workMaterials.setExternalBusy(true);
          showNotice("Доступ к материалам наряда не подтверждён. Обновите кабинет, чтобы заново проверить права.", true);
        }
        return false;
      }
    });
    $("work-materials-nav").addEventListener("click", (event) => {
      event.preventDefault();
      if (busy) return;
      syncWorkMaterialsContext();
      if ($("work-materials").hidden || workMaterialsAccessRejected) return;
      if (location.hash !== "#work-materials") history.pushState(null, "", "#work-materials");
      $("work-materials-heading").focus();
    });
  }
  function packageSessionError(kind, error, outcomeNotice = "") {
    if (error.status === 401 || noNativeSession(error)) {
      handleError(error);
      if (outcomeNotice) showNotice(outcomeNotice + " Сеанс завершён. Войдите снова.", true);
      return true;
    }
    if (error.status === 403 || error.status === 404) {
      clearPackageContext(kind);
      showNotice((outcomeNotice ? outcomeNotice + " " : "") + "Доступ не подтверждён. Обновите кабинет, чтобы заново проверить права.", true);
    }
    return false;
  }
  if (globalThis.VodokanalWorkOrders?.create && $("work-orders-app")) {
    workOrders = globalThis.VodokanalWorkOrders.create({
      root: $("work-orders-app"), request: requestWorkOrders, requestBinary: requestWorkBinary,
      onMutationLock(locked) { publishModuleLock("orders", locked); },
      onSessionError(error, notice) { return packageSessionError("orders", error, notice); },
      onMaterials(selection) {
        const context = workMaterialsContext();
        if (!workMaterials || workMaterialsAccessRejected || selection.workspaceId !== context.workspaceId ||
            ![...context.dispatcherAreaIds, ...context.crewLeaderAreaIds].includes(selection.areaId)) return;
        syncWorkMaterialsContext();
        if ($("work-materials").hidden) return;
        activateSection("work-materials");
        showNotice("Выберите участок и загрузите наряд.");
      }
    });
    $("work-orders-nav").addEventListener("click", event => {
      event.preventDefault(); if (busy) return;
      syncPackageContext("orders");
      if ($("work-orders").hidden || workOrdersAccessRejected) return;
      if (location.hash !== "#work-orders") history.pushState(null, "", "#work-orders");
      $("wo-heading").focus();
    });
  }
  if (globalThis.VodokanalHydrology?.create && $("hydrology-app")) {
    hydrology = globalThis.VodokanalHydrology.create({
      root: $("hydrology-app"), request: requestHydrology, setGlobalBusy: setBusy,
      onMutationLock(locked) { publishModuleLock("hydrology", locked); },
      onSessionError(error, notice) { return packageSessionError("hydrology", error, notice); }
    });
    $("hydrology-nav").addEventListener("click", event => {
      event.preventDefault(); if (busy) return;
      syncPackageContext("hydrology");
      if ($("hydrology").hidden || hydrologyAccessRejected) return;
      if (location.hash !== "#hydrology") history.pushState(null, "", "#hydrology");
      const heading = $("hydrology-app").querySelector("h2");
      if (heading) { heading.tabIndex = -1; heading.focus(); }
    });
  }
  if (globalThis.VodokanalIdentity?.createAccount && $("identity-account")) {
    identityAccount = globalThis.VodokanalIdentity.createAccount({ root: $("identity-account"), request: moduleRequest("identity"), onSessionError: additionalSessionError,
      onMutationLock(locked) { publishModuleLock("identity", locked); },
      async onOwnershipChanged() {
        const workspaceId = state.workspaceId; setBusy(true);
        try { await loadDashboard(workspaceId); showNotice("Права управления обновлены."); }
        catch (error) { handleError(error); }
        finally { setBusy(false); }
      } });
  }
  if (globalThis.VodokanalDocuments?.create && $("documents-app")) {
    documents = globalThis.VodokanalDocuments.create({ root: $("documents-app"), request: moduleRequest("documents"), requestBinary: requestAdditionalBinary,
      setGlobalBusy: setBusy, onSessionError: additionalSessionError, onMutationLock(locked) { publishModuleLock("documents", locked); } });
  }
  if (globalThis.VodokanalSubscriberWater?.create && $("subscriber-water-app")) {
    subscriberWater = globalThis.VodokanalSubscriberWater.create({ root: $("subscriber-water-app"), request: moduleRequest("subscriber"),
      download: downloadAdditional, getContext: extraContext, onError: handleError, onMutationLock(locked) { publishModuleLock("subscriber", locked); } });
  }
  if (globalThis.PortalDispatchUI?.create && $("dispatch-app")) {
    dispatchModule = globalThis.PortalDispatchUI.create({ root: $("dispatch-app"), request: moduleRequest("dispatch"), requestBinary: requestDispatchBinary,
      onSessionError: additionalSessionError, onMutationLock(locked) { publishModuleLock("dispatch", locked); } });
  }
  if (globalThis.VodokanalOperations?.create && $("operations-app")) {
    operations = globalThis.VodokanalOperations.create({ root: $("operations-app"), request: moduleRequest("operations"), onSessionError: additionalSessionError,
      onMutationLock(locked) { publishModuleLock("operations", locked); } });
  }
  if (globalThis.PublicPortalAdmin?.mount && $("public-editor-app")) {
    publicEditor = globalThis.PublicPortalAdmin.mount({ root: $("public-editor-app"), request: moduleRequest("public"), getWorkspaceId: () => isOwner() ? state.workspaceId : "", onSessionError: additionalSessionError,
      onMutationLock(locked) { publishModuleLock("public", locked); } });
    $("public-editor-load").addEventListener("click", async () => {
      if (busy || !isOwner()) return;
      try { await publicEditor.refresh(); } catch (error) { handleError(error); }
    });
  }
  for (const link of document.querySelectorAll('.navigation a[href^="#"]')) {
    link.addEventListener("click", event => {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      if (busy || !target || target.hidden) { event.preventDefault(); return; }
      event.preventDefault(); activateSection(target.id);
    });
  }
  window.addEventListener("popstate", () => {
    const epoch = hostEpoch, target = location.hash;
    window.requestAnimationFrame(() => {
      if (epoch === hostEpoch && !busy && state.me && target && location.hash === target) activateSection(target.slice(1), true);
    });
  });
  window.addEventListener("pagehide", () => {
    globalThis.VodokanalIdentity?.clearPublic?.();
    clearSession("Страница скрыта. Перед продолжением доступ будет проверен заново.");
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    setBusy(true);
    loadDashboard().catch(error => {
      if (error?.code !== "контекст_изменено") clearSession(errorMessage(error));
    }).finally(() => setBusy(false));
  });
  publishModuleLock("orders", false);
  setBusy(true);
  loadDashboard().catch((error) => {
    if (error?.code === "контекст_изменено") return;
    clearSession(error.status === 401 || noNativeSession(error) ? "Войдите под своей учётной записью портала." : errorMessage(error));
  }).finally(() => { setBusy(false); });
})();
