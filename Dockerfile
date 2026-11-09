FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src
COPY backend/FinancialMonitor.Api/FinancialMonitor.Api.csproj backend/FinancialMonitor.Api/
RUN dotnet restore backend/FinancialMonitor.Api/FinancialMonitor.Api.csproj
COPY backend/FinancialMonitor.Api/ backend/FinancialMonitor.Api/
RUN dotnet publish backend/FinancialMonitor.Api/FinancialMonitor.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false
COPY --from=web /src/frontend/dist/ /app/wwwroot/

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS final
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true
COPY --from=build /app/ ./
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "FinancialMonitor.Api.dll"]
